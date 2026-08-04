import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

function recomputeConflictTotals(data) {
  data.merge_conflict_count = data.merge_conflicts.length;
  data.scope_violation_count = data.scope_violations.length;
  data.conflict_count = data.merge_conflict_count + data.scope_violation_count;
}

function median(sortedNums) {
  if (!sortedNums.length) return null;
  const mid = Math.floor(sortedNums.length / 2);
  return sortedNums.length % 2
    ? sortedNums[mid]
    : Math.round((sortedNums[mid - 1] + sortedNums[mid]) / 2);
}

/** Aggregate real token usage from agent_calls (requires runner json output). */
function aggregateTokens(agentCalls) {
  const totals = { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0 };
  const byModel = {};
  const byRole = {};
  let covered = 0;
  for (const c of agentCalls) {
    if (c.tokens_in == null && c.tokens_out == null) continue;
    covered += 1;
    const tin = c.tokens_in || 0;
    const tout = c.tokens_out || 0;
    const tcr = c.tokens_cache_read || 0;
    const tcw = c.tokens_cache_write || 0;
    totals.input += tin;
    totals.output += tout;
    totals.cache_read += tcr;
    totals.cache_write += tcw;
    for (const [map, key] of [[byModel, c.model || "unknown"], [byRole, c.role || "unknown"]]) {
      if (!map[key]) map[key] = { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0, calls: 0 };
      map[key].input += tin;
      map[key].output += tout;
      map[key].cache_read += tcr;
      map[key].cache_write += tcw;
      map[key].total += tin + tout;
      map[key].calls += 1;
    }
  }
  totals.total = totals.input + totals.output;
  return { totals, byModel, byRole, covered };
}

/**
 * 四个核心指标（Cursor 命题复现）:
 *   1. task_completion / pass_rate_* —— 任务完成率
 *   2. task_time_ms —— 单任务完成时间
 *   3. tokens —— 消耗 token（按模型/角色分层，strong vs cheap 经济学）
 *   4. wall_time_ms / time_to_all_tasks_done_ms / agent_time_ms —— 总完成时长
 */
export function buildCoreMetrics(data) {
  const tasks = data.tasks || [];
  const tasksTotal = tasks.length;
  const tasksDone = tasks.filter((t) => t.status === "done").length;
  const timed = tasks.filter((t) => typeof t.elapsedMs === "number");
  const perTask = {};
  for (const t of timed) perTask[t.id] = t.elapsedMs;
  const times = timed.map((t) => t.elapsedMs).sort((x, y) => x - y);
  const timeSum = times.reduce((s, v) => s + v, 0);

  const agentCalls = data.agent_calls || [];
  const agentTimeMs = agentCalls.reduce((s, c) => s + (c.elapsedMs || 0), 0);
  const apiTimeMs = agentCalls.reduce((s, c) => s + (c.api_ms || 0), 0);
  const { totals, byModel, byRole, covered } = aggregateTokens(agentCalls);

  // Prefer active segments (excludes death gaps between resume attempts).
  let wallTimeMs = null;
  const segments = data.segments || [];
  if (segments.length) {
    let sum = 0;
    for (const seg of segments) {
      if (!seg?.started_at) continue;
      const end = seg.ended_at ? Date.parse(seg.ended_at) : Date.now();
      const start = Date.parse(seg.started_at);
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) sum += end - start;
    }
    wallTimeMs = sum || null;
  } else if (data.started_at && data.finished_at) {
    wallTimeMs = Date.parse(data.finished_at) - Date.parse(data.started_at);
  }

  // Time from run start until the last task finished (总完成任务时长 in the
  // strict sense; excludes repair/review phases that follow the pool).
  let timeToAllTasksDoneMs = null;
  if (data.started_at && timed.length) {
    let latest = null;
    for (const t of timed) {
      if (!t.started_at) continue;
      const end = Date.parse(t.started_at) + t.elapsedMs;
      if (latest == null || end > latest) latest = end;
    }
    if (latest != null) timeToAllTasksDoneMs = latest - Date.parse(data.started_at);
  }

  return {
    task_completion: {
      done: tasksDone,
      total: tasksTotal,
      rate: tasksTotal ? Number((tasksDone / tasksTotal).toFixed(4)) : null,
    },
    pass_rate_full: data.final_score?.rate ?? null,
    pass_rate_visible: data.visible_score?.rate ?? null,
    pass_rate_holdout: data.holdout_score?.rate ?? null,
    task_time_ms: times.length
      ? {
        mean: Math.round(timeSum / times.length),
        median: median(times),
        min: times[0],
        max: times[times.length - 1],
        total: timeSum,
        per_task: perTask,
      }
      : null,
    tokens: {
      ...totals,
      calls_with_usage: covered,
      calls_total: agentCalls.length,
      by_model: byModel,
      by_role: byRole,
    },
    wall_time_ms: wallTimeMs,
    time_to_all_tasks_done_ms: timeToAllTasksDoneMs,
    agent_time_ms: agentTimeMs,
    agent_api_time_ms: apiTimeMs || null,
    effective_parallelism: wallTimeMs && agentTimeMs
      ? Number((agentTimeMs / wallTimeMs).toFixed(2))
      : null,
  };
}

function buildPhaseCostCurve(data) {
  const buckets = {
    pool: { agent_ms: 0, passed_delta: 0 },
    feedback: { agent_ms: 0, passed_delta: 0 },
    "repair-rung1": { agent_ms: 0, passed_delta: 0 },
    "repair-rung2": { agent_ms: 0, passed_delta: 0 },
    "repair-rung3": { agent_ms: 0, passed_delta: 0 },
    "repair-stage-b": { agent_ms: 0, passed_delta: 0 },
  };

  for (const call of data.agent_calls || []) {
    const ms = call.elapsedMs || 0;
    if (call.role === "worker" && !call.round) buckets.pool.agent_ms += ms;
    else if (call.role === "worker-fix") buckets.feedback.agent_ms += ms;
    else if (call.role === "repair") buckets["repair-rung1"].agent_ms += ms;
    else if (call.role === "repair-candidate") buckets["repair-rung2"].agent_ms += ms;
    else if (call.role === "repair-strong") buckets["repair-rung3"].agent_ms += ms;
    else if (call.role === "global-repair") buckets["repair-rung1"].agent_ms += ms;
  }

  for (const rc of data.repair_clusters || []) {
    const key = rc.rung === 3 ? "repair-rung3" : (rc.rung === 2 ? "repair-rung2" : "repair-rung1");
    if (rc.accepted) buckets[key].passed_delta += rc.gain_items || 0;
  }
  for (const rc of data.repair_stage_b || []) {
    buckets["repair-stage-b"].agent_ms += rc.elapsedMs || 0;
    if (rc.accepted) buckets["repair-stage-b"].passed_delta += rc.gain_full || 0;
  }

  // Score-curve deltas for pool/feedback (best-effort from after-task points).
  const curve = data.score_curve || [];
  let prevPassed = 0;
  for (const pt of curve) {
    const phase = String(pt.phase || "");
    const passed = pt.passed || 0;
    if (phase.startsWith("after-")) {
      buckets.pool.passed_delta += Math.max(0, passed - prevPassed);
      prevPassed = passed;
    }
  }

  return buckets;
}

function emptyMetricsData() {
  return {
    started_at: new Date().toISOString(),
    finished_at: null,
    finalized: false,
    salvaged: false,
    segments: [],
    coordination: false,
    planner_source: null,
    commits: 0,
    merge_conflicts: [],
    scope_violations: [],
    cross_scope_changes: [],
    integration_fixes: [],
    score_feedbacks: [],
    worktree_syncs: [],
    merge_gate_rejections: [],
    post_merge_gate_failures: [],
    global_repairs: [],
    repair_clusters: [],
    repair_stage_b: [],
    overfit_reviews: [],
    decompositions: [],
    gen_examples: null,
    adjudications: [],
    suspected_oracle_bugs: [],
    spec_ambiguities: [],
    unowned_requirements: [],
    oracle_literal_hits: [],
    swarm_planner_rounds: 0,
    planner_parse_failures: 0,
    planner_spawn_failures: 0,
    quality_merge_count: 0,
    last_observe: null,
    observe_history: [],
    stop_observe_rate: null,
    tree_stats: null,
    reviews: [],
    splits: [],
    oversized_blocks: [],
    merge_waits: [],
    merge_wait_count: 0,
    width_curve: [],
    design_write_conflicts: 0,
    self_check_total: 0,
    harness_self_check_total: 0,
    visible_score: null,
    holdout_score: null,
    holdout_gap_pp: null,
    overfit_alarm: false,
    adjudication_parse_failures: 0,
    merge_conflict_count: 0,
    scope_violation_count: 0,
    cross_scope_change_count: 0,
    integration_fix_count: 0,
    score_feedback_count: 0,
    worktree_sync_count: 0,
    worktree_sync_conflict_count: 0,
    merge_gate_rejection_count: 0,
    post_merge_gate_failure_count: 0,
    global_repair_count: 0,
    conflict_count: 0,
    tasks: [],
    score_curve: [],
    agent_calls: [],
    loc: null,
    final_score: null,
  };
}

function applyDerivedFields(data, extra = {}) {
  recomputeConflictTotals(data);
  const agentCalls = data.agent_calls || [];
  const repair_time_ms = agentCalls
    .filter((c) => c.role === "repair" || c.role === "repair-candidate" || c.role === "repair-strong" || c.role === "global-repair")
    .reduce((s, c) => s + (c.elapsedMs || 0), 0);
  const adjudication_time_ms = agentCalls
    .filter((c) => c.role === "adjudicator" || c.role === "cluster")
    .reduce((s, c) => s + (c.elapsedMs || 0), 0);
  const strong_model_time_ms = agentCalls
    .filter((c) => [
      "repair-strong", "decomposer", "adjudicator", "cluster",
      "swarm-planner", "splitter", "review-spec", "json-repair",
    ].includes(c.role))
    .reduce((s, c) => s + (c.elapsedMs || 0), 0);
  Object.assign(data, {
    repair_time_ms,
    adjudication_time_ms,
    strong_model_time_ms,
    global_repair_time_ms: data.global_repair_time_ms ?? repair_time_ms,
    phase_cost_curve: buildPhaseCostCurve(data),
  }, extra);
  data.core_metrics = buildCoreMetrics(data);
}

function touchCurrentSegment(data) {
  if (!Array.isArray(data.segments)) data.segments = [];
  if (!data.segments.length) {
    data.segments.push({ started_at: data.started_at || new Date().toISOString(), ended_at: null });
  }
  const seg = data.segments[data.segments.length - 1];
  seg.ended_at = new Date().toISOString();
}

/**
 * @param {string} runDir
 * @param {{ seed?: object, resume?: boolean }} [opts]
 */
export function createMetricsCollector(runDir, opts = {}) {
  const seed = opts.seed && typeof opts.seed === "object" ? opts.seed : null;
  const data = seed
    ? { ...emptyMetricsData(), ...seed }
    : emptyMetricsData();

  if (!Array.isArray(data.segments)) data.segments = [];
  data.finalized = false;
  data.finished_at = null;

  if (opts.resume) {
    // New active segment after interruption gap.
    data.segments.push({ started_at: new Date().toISOString(), ended_at: null });
  } else if (!data.segments.length) {
    data.segments.push({ started_at: data.started_at || new Date().toISOString(), ended_at: null });
  }
  if (!seed) {
    data.started_at = data.segments[0].started_at;
  }

  function persist(finalized) {
    touchCurrentSegment(data);
    data.finalized = !!finalized;
    const out = path.join(runDir, "metrics.json");
    writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    return out;
  }

  return {
    data,
    recordAgentCall(entry) {
      data.agent_calls.push({ ...entry, at: new Date().toISOString() });
    },
    recordMergeConflict(entry) {
      data.merge_conflicts.push({ ...entry, at: new Date().toISOString() });
      recomputeConflictTotals(data);
    },
    recordScopeViolation(entry) {
      data.scope_violations.push({ ...entry, at: new Date().toISOString() });
      recomputeConflictTotals(data);
    },
    recordCrossScopeChange(entry) {
      data.cross_scope_changes.push({ ...entry, at: new Date().toISOString() });
      data.cross_scope_change_count = data.cross_scope_changes.length;
    },
    recordIntegrationFix(entry) {
      data.integration_fixes.push({ ...entry, at: new Date().toISOString() });
      data.integration_fix_count = data.integration_fixes.length;
    },
    recordScoreFeedback(entry) {
      data.score_feedbacks.push({ ...entry, at: new Date().toISOString() });
      data.score_feedback_count = data.score_feedbacks.length;
    },
    recordWorktreeSync(entry) {
      data.worktree_syncs.push({ ...entry, at: new Date().toISOString() });
      data.worktree_sync_count = data.worktree_syncs.length;
      data.worktree_sync_conflict_count = data.worktree_syncs.filter((e) => e.conflict).length;
    },
    recordMergeGateRejection(entry) {
      data.merge_gate_rejections.push({ ...entry, at: new Date().toISOString() });
      data.merge_gate_rejection_count = data.merge_gate_rejections.length;
    },
    recordPostMergeGateFailure(entry) {
      data.post_merge_gate_failures.push({ ...entry, at: new Date().toISOString() });
      data.post_merge_gate_failure_count = data.post_merge_gate_failures.length;
    },
    recordGlobalRepair(entry) {
      data.global_repairs.push({ ...entry, at: new Date().toISOString() });
      data.global_repair_count = data.global_repairs.length;
    },
    recordOversizedBlock(entry) {
      data.oversized_blocks.push({ ...entry, at: new Date().toISOString() });
    },
    recordMergeWait(entry) {
      data.merge_waits.push({ ...entry, at: new Date().toISOString() });
      data.merge_wait_count = data.merge_waits.length;
    },
    recordTask(entry) {
      const idx = data.tasks.findIndex((t) => t.id === entry.id);
      if (idx >= 0) data.tasks[idx] = { ...data.tasks[idx], ...entry };
      else data.tasks.push(entry);
    },
    recordScore(point) {
      data.score_curve.push({ ...point, at: new Date().toISOString() });
    },
    setMeta(partial) {
      Object.assign(data, partial);
    },
    /** Periodic / post-leaf persistence. Does not set finished_at. */
    checkpoint(extra = {}) {
      applyDerivedFields(data, extra);
      return persist(false);
    },
    finish(extra = {}) {
      data.finished_at = new Date().toISOString();
      applyDerivedFields(data, extra);
      return persist(true);
    },
  };
}

/** Load metrics.json seed for resume / finalize (null if missing). */
export function loadMetricsSeed(runDir) {
  const p = path.join(runDir, "metrics.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Sum tokens_in + tokens_out across agent_calls (excludes cache_read/write).
 * Used for optional swarm token budget hard-stop.
 */
export function totalTokensInOut(data) {
  let sum = 0;
  for (const c of data?.agent_calls || []) {
    sum += Number(c.tokens_in) || 0;
    sum += Number(c.tokens_out) || 0;
  }
  return sum;
}

/** Active wall minutes from segments (excludes death gaps). */
export function activeWallMinutes(data) {
  const segments = data?.segments || [];
  if (!segments.length) {
    if (data?.started_at) {
      return Math.max(0, (Date.now() - Date.parse(data.started_at)) / 60000);
    }
    return 0;
  }
  let sum = 0;
  for (const seg of segments) {
    if (!seg?.started_at) continue;
    const end = seg.ended_at ? Date.parse(seg.ended_at) : Date.now();
    const start = Date.parse(seg.started_at);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) sum += end - start;
  }
  return sum / 60000;
}

export function countLoc(workspaceDir) {
  let lines = 0;
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = statSync(p);
      if (st.isDirectory() && name !== "node_modules" && name !== "dist") walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(name) && !name.endsWith(".d.ts")) {
        lines += readFileSync(p, "utf8").split("\n").length;
      }
    }
  }
  const src = path.join(workspaceDir, "src");
  if (existsSync(src)) walk(src);
  return lines;
}

export function countTasksDone(tasks) {
  return (tasks || []).filter((t) => t.status === "done").length;
}

/** Normalize legacy metrics.json (conflicts[] only) for compare-runs. */
export function normalizeMetrics(raw) {
  const m = { ...raw };
  if (!m.merge_conflicts && Array.isArray(m.conflicts)) {
    m.merge_conflicts = m.conflicts.filter((c) => c.type !== "scope_violation");
    m.scope_violations = m.conflicts.filter((c) => c.type === "scope_violation");
  }
  m.merge_conflicts = m.merge_conflicts || [];
  m.scope_violations = m.scope_violations || [];
  m.cross_scope_changes = m.cross_scope_changes || [];
  m.integration_fixes = m.integration_fixes || [];
  m.score_feedbacks = m.score_feedbacks || [];
  m.worktree_syncs = m.worktree_syncs || [];
  m.merge_gate_rejections = m.merge_gate_rejections || [];
  m.post_merge_gate_failures = m.post_merge_gate_failures || [];
  m.global_repairs = m.global_repairs || [];
  m.repair_clusters = m.repair_clusters || [];
  m.repair_stage_b = m.repair_stage_b || [];
  m.overfit_reviews = m.overfit_reviews || [];
  m.decompositions = m.decompositions || [];
  m.gen_examples = m.gen_examples ?? null;
  m.adjudications = m.adjudications || [];
  m.suspected_oracle_bugs = m.suspected_oracle_bugs || [];
  m.spec_ambiguities = m.spec_ambiguities || [];
  m.unowned_requirements = m.unowned_requirements || [];
  m.oracle_literal_hits = m.oracle_literal_hits || [];
  m.swarm_planner_rounds = m.swarm_planner_rounds ?? 0;
  m.planner_parse_failures = m.planner_parse_failures ?? 0;
  m.planner_spawn_failures = m.planner_spawn_failures ?? 0;
  m.quality_merge_count = m.quality_merge_count ?? 0;
  m.last_observe = m.last_observe ?? null;
  m.observe_history = m.observe_history || [];
  m.stop_observe_rate = m.stop_observe_rate ?? null;
  m.tree_stats = m.tree_stats ?? null;
  m.reviews = m.reviews || [];
  m.splits = m.splits || [];
  m.oversized_blocks = m.oversized_blocks || [];
  m.merge_waits = m.merge_waits || [];
  m.merge_wait_count = m.merge_wait_count ?? m.merge_waits.length;
  m.width_curve = m.width_curve || [];
  m.design_write_conflicts = m.design_write_conflicts ?? 0;
  m.self_check_total = m.self_check_total ?? 0;
  m.harness_self_check_total = m.harness_self_check_total ?? 0;
  m.segments = m.segments || [];
  m.finalized = m.finalized ?? true;
  m.salvaged = !!m.salvaged;
  m.visible_score = m.visible_score ?? null;
  m.holdout_score = m.holdout_score ?? null;
  m.holdout_gap_pp = m.holdout_gap_pp ?? null;
  m.overfit_alarm = !!m.overfit_alarm;
  m.adjudication_parse_failures = m.adjudication_parse_failures ?? 0;
  m.phase_cost_curve = m.phase_cost_curve ?? null;
  // Older runs predate core_metrics; rebuild what's derivable (task times,
  // wall time). Token fields stay zero-coverage for pre-json-output runs.
  m.core_metrics = m.core_metrics ?? buildCoreMetrics(m);
  m.repair_time_ms = m.repair_time_ms ?? m.global_repair_time_ms ?? null;
  m.adjudication_time_ms = m.adjudication_time_ms ?? null;
  m.strong_model_time_ms = m.strong_model_time_ms ?? null;
  m.merge_conflict_count = m.merge_conflicts.length;
  m.scope_violation_count = m.scope_violations.length;
  m.cross_scope_change_count = m.cross_scope_changes.length;
  m.integration_fix_count = m.integration_fixes.length;
  m.score_feedback_count = m.score_feedbacks.length;
  m.worktree_sync_count = m.worktree_sync_count ?? m.worktree_syncs.length;
  m.worktree_sync_conflict_count = m.worktree_sync_conflict_count
    ?? m.worktree_syncs.filter((e) => e.conflict).length;
  m.merge_gate_rejection_count = m.merge_gate_rejection_count ?? m.merge_gate_rejections.length;
  m.post_merge_gate_failure_count = m.post_merge_gate_failure_count
    ?? m.post_merge_gate_failures.length;
  m.global_repair_count = m.global_repair_count ?? m.global_repairs.length;
  m.conflict_count = m.merge_conflict_count + m.scope_violation_count;
  m.churn = m.churn ?? null;
  m.merge_resolve_time_ms = m.merge_resolve_time_ms ?? null;
  m.integration_fix_time_ms = m.integration_fix_time_ms ?? null;
  m.worker_fix_time_ms = m.worker_fix_time_ms ?? null;
  m.global_repair_time_ms = m.global_repair_time_ms ?? null;
  m.task_set = m.task_set ?? null;
  return m;
}
