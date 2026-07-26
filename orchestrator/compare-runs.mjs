#!/usr/bin/env node
/**
 * Compare two run metrics.json files (Run A vs Run B).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { countTasksDone, normalizeMetrics } from "./metrics.mjs";

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) {
  console.log(`Usage: node orchestrator/compare-runs.mjs runs/run-a/metrics.json runs/run-b/metrics.json
   or: npm run compare -- runs/run-a/metrics.json runs/run-b/metrics.json`);
  process.exit(1);
}

function load(p) {
  return normalizeMetrics(JSON.parse(readFileSync(path.resolve(p), "utf8")));
}

const a = load(aPath);
const b = load(bPath);

function row(label, va, vb) {
  console.log(`${label.padEnd(24)} ${String(va).padEnd(18)} ${String(vb)}`);
}

function pct(score) {
  if (!score || score.rate == null) return "-";
  return `${(score.rate * 100).toFixed(1)}% (${score.passed}/${score.total})`;
}

function repairAccepted(m) {
  const clusters = m.repair_clusters || [];
  if (!clusters.length) return `${m.global_repair_count ?? 0} (legacy)`;
  const ok = clusters.filter((c) => c.accepted).length;
  return `${ok}/${clusters.length}`;
}

function rung2Count(m) {
  return (m.repair_clusters || []).filter((c) => c.rung === 2).length;
}

function rung3Count(m) {
  const a = (m.repair_clusters || []).filter((c) => c.rung === 3).length;
  const b = (m.repair_stage_b || []).filter((c) => c.rung === 3).length;
  return a + b;
}

function stageBGain(m) {
  return (m.repair_stage_b || []).filter((c) => c.accepted).reduce((s, c) => s + (c.gain_full || 0), 0);
}

function suspiciousReviews(m) {
  return (m.overfit_reviews || []).filter((r) => r.verdict === "suspicious").length;
}

console.log("\n=== mini-swarm A/B comparison ===\n");
row("Metric", "Run A", "Run B");
row("coordination", a.coordination, b.coordination);
row(
  "coord mode",
  a.coordination_mode ?? (a.coordination ? "strict" : "none"),
  b.coordination_mode ?? (b.coordination ? "strict" : "none"),
);
row("planner_source", a.planner_source ?? "?", b.planner_source ?? "?");
row("pass rate (full)", pct(a.final_score), pct(b.final_score));
row("visible score", pct(a.visible_score), pct(b.visible_score));
row("holdout score", pct(a.holdout_score), pct(b.holdout_score));
row(
  "holdout_gap_pp",
  a.holdout_gap_pp != null ? a.holdout_gap_pp.toFixed(1) : "-",
  b.holdout_gap_pp != null ? b.holdout_gap_pp.toFixed(1) : "-",
);
row("tasks done", `${countTasksDone(a.tasks)}/${a.tasks?.length ?? "?"}`, `${countTasksDone(b.tasks)}/${b.tasks?.length ?? "?"}`);
row("merge conflicts", a.merge_conflict_count, b.merge_conflict_count);
row("scope violations", a.scope_violation_count, b.scope_violation_count);
row("task_set", a.task_set ?? "-", b.task_set ?? "-");
row("cross-scope changes", a.cross_scope_change_count, b.cross_scope_change_count);
row("integration fixes", a.integration_fix_count, b.integration_fix_count);
row("commits", a.commits, b.commits);
row(
  "churn_ratio",
  a.churn?.churn_ratio != null ? `${(a.churn.churn_ratio * 100).toFixed(1)}%` : "-",
  b.churn?.churn_ratio != null ? `${(b.churn.churn_ratio * 100).toFixed(1)}%` : "-",
);
row(
  "merge_resolve_min",
  a.merge_resolve_time_ms != null ? (a.merge_resolve_time_ms / 60000).toFixed(1) : "-",
  b.merge_resolve_time_ms != null ? (b.merge_resolve_time_ms / 60000).toFixed(1) : "-",
);
row(
  "integration_fix_min",
  a.integration_fix_time_ms != null ? (a.integration_fix_time_ms / 60000).toFixed(1) : "-",
  b.integration_fix_time_ms != null ? (b.integration_fix_time_ms / 60000).toFixed(1) : "-",
);
row("score feedbacks", a.score_feedback_count ?? 0, b.score_feedback_count ?? 0);
row(
  "worker_fix_min",
  a.worker_fix_time_ms != null ? (a.worker_fix_time_ms / 60000).toFixed(1) : "-",
  b.worker_fix_time_ms != null ? (b.worker_fix_time_ms / 60000).toFixed(1) : "-",
);
row(
  "worktree syncs",
  `${a.worktree_sync_count ?? 0} (${a.worktree_sync_conflict_count ?? 0} conflict)`,
  `${b.worktree_sync_count ?? 0} (${b.worktree_sync_conflict_count ?? 0} conflict)`,
);
row("merge gate rejections", a.merge_gate_rejection_count ?? 0, b.merge_gate_rejection_count ?? 0);
row("repair clusters", repairAccepted(a), repairAccepted(b));
row("rung2 attempts", rung2Count(a), rung2Count(b));
row("rung3 attempts", rung3Count(a), rung3Count(b));
row("stage_b_gain", stageBGain(a), stageBGain(b));
row("stage_b_clusters", (a.repair_stage_b || []).length, (b.repair_stage_b || []).length);
row("overfit_suspicious", suspiciousReviews(a), suspiciousReviews(b));
row("adjudications", (a.adjudications || []).length, (b.adjudications || []).length);
row("suspected_oracle", (a.suspected_oracle_bugs || []).length, (b.suspected_oracle_bugs || []).length);
row(
  "repair_min",
  a.repair_time_ms != null ? (a.repair_time_ms / 60000).toFixed(1)
    : (a.global_repair_time_ms != null ? (a.global_repair_time_ms / 60000).toFixed(1) : "-"),
  b.repair_time_ms != null ? (b.repair_time_ms / 60000).toFixed(1)
    : (b.global_repair_time_ms != null ? (b.global_repair_time_ms / 60000).toFixed(1) : "-"),
);
row(
  "strong_model_min",
  a.strong_model_time_ms != null ? (a.strong_model_time_ms / 60000).toFixed(1) : "-",
  b.strong_model_time_ms != null ? (b.strong_model_time_ms / 60000).toFixed(1) : "-",
);
row("loc", a.loc, b.loc);
row("agent calls", a.agent_calls?.length, b.agent_calls?.length);
const aMs = a.agent_calls?.reduce((s, c) => s + (c.elapsedMs || 0), 0) || 0;
const bMs = b.agent_calls?.reduce((s, c) => s + (c.elapsedMs || 0), 0) || 0;
row("agent time (ms)", aMs, bMs);
console.log("");
