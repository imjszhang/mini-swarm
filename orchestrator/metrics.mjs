import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

function recomputeConflictTotals(data) {
  data.merge_conflict_count = data.merge_conflicts.length;
  data.scope_violation_count = data.scope_violations.length;
  data.conflict_count = data.merge_conflict_count + data.scope_violation_count;
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

export function createMetricsCollector(runDir) {
  const data = {
    started_at: new Date().toISOString(),
    finished_at: null,
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
    global_repair_count: 0,
    conflict_count: 0,
    tasks: [],
    score_curve: [],
    agent_calls: [],
    loc: null,
    final_score: null,
  };

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
    recordGlobalRepair(entry) {
      data.global_repairs.push({ ...entry, at: new Date().toISOString() });
      data.global_repair_count = data.global_repairs.length;
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
    finish(extra = {}) {
      data.finished_at = new Date().toISOString();
      recomputeConflictTotals(data);
      const agentCalls = data.agent_calls || [];
      const repair_time_ms = agentCalls
        .filter((c) => c.role === "repair" || c.role === "repair-candidate" || c.role === "repair-strong" || c.role === "global-repair")
        .reduce((s, c) => s + (c.elapsedMs || 0), 0);
      const adjudication_time_ms = agentCalls
        .filter((c) => c.role === "adjudicator" || c.role === "cluster")
        .reduce((s, c) => s + (c.elapsedMs || 0), 0);
      const strong_model_time_ms = agentCalls
        .filter((c) => ["repair-strong", "decomposer", "adjudicator", "cluster"].includes(c.role))
        .reduce((s, c) => s + (c.elapsedMs || 0), 0);
      Object.assign(data, {
        repair_time_ms,
        adjudication_time_ms,
        strong_model_time_ms,
        // Keep legacy alias for compare scripts.
        global_repair_time_ms: data.global_repair_time_ms ?? repair_time_ms,
        phase_cost_curve: buildPhaseCostCurve(data),
      }, extra);
      const out = path.join(runDir, "metrics.json");
      writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      return out;
    },
  };
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
  m.visible_score = m.visible_score ?? null;
  m.holdout_score = m.holdout_score ?? null;
  m.holdout_gap_pp = m.holdout_gap_pp ?? null;
  m.overfit_alarm = !!m.overfit_alarm;
  m.adjudication_parse_failures = m.adjudication_parse_failures ?? 0;
  m.phase_cost_curve = m.phase_cost_curve ?? null;
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
