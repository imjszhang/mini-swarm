import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

function recomputeConflictTotals(data) {
  data.merge_conflict_count = data.merge_conflicts.length;
  data.scope_violation_count = data.scope_violations.length;
  data.conflict_count = data.merge_conflict_count + data.scope_violation_count;
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
      Object.assign(data, extra);
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
