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

function fmtMin(ms) {
  return ms != null ? (ms / 60000).toFixed(1) : "-";
}

function fmtTokens(n) {
  if (n == null) return "-";
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

function coreTaskTime(m) {
  const t = m.core_metrics?.task_time_ms;
  if (!t) return "-";
  return `med ${fmtMin(t.median)}m / max ${fmtMin(t.max)}m`;
}

function coreTokensTotal(m) {
  const t = m.core_metrics?.tokens;
  if (!t || !t.calls_with_usage) return "-";
  return `${fmtTokens(t.total)} (in ${fmtTokens(t.input)} / out ${fmtTokens(t.output)})`;
}

function coreTokensByModel(m) {
  const by = m.core_metrics?.tokens?.by_model || {};
  const parts = Object.entries(by).map(([k, v]) => `${k}=${fmtTokens(v.total)}`);
  return parts.length ? parts.join(" ") : "-";
}

function usageCoverage(m) {
  const t = m.core_metrics?.tokens;
  if (!t) return "-";
  return `${t.calls_with_usage}/${t.calls_total}`;
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
// --- 四核心指标（完成率见上：pass rate / tasks done）---
row("task_time (核心#2)", coreTaskTime(a), coreTaskTime(b));
row("tokens (核心#3)", coreTokensTotal(a), coreTokensTotal(b));
row("tokens by model", coreTokensByModel(a), coreTokensByModel(b));
row("usage coverage", usageCoverage(a), usageCoverage(b));
row("wall_min (核心#4)", fmtMin(a.core_metrics?.wall_time_ms), fmtMin(b.core_metrics?.wall_time_ms));
row("tasks_done_min", fmtMin(a.core_metrics?.time_to_all_tasks_done_ms), fmtMin(b.core_metrics?.time_to_all_tasks_done_ms));
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
row("swarm_planner_rounds", a.swarm_planner_rounds ?? 0, b.swarm_planner_rounds ?? 0);
row("review stacks", (a.reviews || []).length, (b.reviews || []).length);
row("planner parse failures", a.planner_parse_failures ?? 0, b.planner_parse_failures ?? 0);
row(
  "active segments",
  (a.segments || []).length || "-",
  (b.segments || []).length || "-",
);
row("swarm splits", (a.splits || []).length, (b.splits || []).length);
row("oversized_blocks", (a.oversized_blocks || []).length, (b.oversized_blocks || []).length);
row(
  "tree leaves done",
  a.tree_stats ? `${a.tree_stats.done}/${a.tree_stats.leaves}` : "-",
  b.tree_stats ? `${b.tree_stats.done}/${b.tree_stats.leaves}` : "-",
);
row(
  "effective_parallelism",
  a.core_metrics?.effective_parallelism ?? "-",
  b.core_metrics?.effective_parallelism ?? "-",
);
row("self_check_total", a.self_check_total ?? 0, b.self_check_total ?? 0);
{
  const medianWait = (waits) => {
    const xs = (waits || []).map((w) => w.waitMs).filter((n) => typeof n === "number").sort((x, y) => x - y);
    if (!xs.length) return "-";
    const mid = Math.floor(xs.length / 2);
    const med = xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
    return (med / 1000).toFixed(1);
  };
  row("merge wait median (s)", medianWait(a.merge_waits), medianWait(b.merge_waits));
}
row("agent calls", a.agent_calls?.length, b.agent_calls?.length);
const aMs = a.agent_calls?.reduce((s, c) => s + (c.elapsedMs || 0), 0) || 0;
const bMs = b.agent_calls?.reduce((s, c) => s + (c.elapsedMs || 0), 0) || 0;
row("agent time (min)", fmtMin(aMs), fmtMin(bMs));
console.log("");
