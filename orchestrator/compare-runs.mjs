#!/usr/bin/env node
/**
 * Compare two run metrics.json files (Run A vs Run B).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { countTasksDone, normalizeMetrics } from "./metrics.mjs";

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) {
  console.log(`Usage: node orchestrator/compare-runs.mjs runs/run-a-bare-v3/metrics.json runs/run-b-coordinated-v3/metrics.json
   or: npm run compare -- runs/run-a-bare-v3/metrics.json runs/run-b-coordinated-v3/metrics.json`);
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

console.log("\n=== mini-swarm A/B comparison ===\n");
row("Metric", "Run A", "Run B");
row("coordination", a.coordination, b.coordination);
row(
  "coord mode",
  a.coordination_mode ?? (a.coordination ? "strict" : "none"),
  b.coordination_mode ?? (b.coordination ? "strict" : "none"),
);
row("planner_source", a.planner_source ?? "?", b.planner_source ?? "?");
row("pass rate", `${(a.final_score?.rate * 100 || 0).toFixed(1)}%`, `${(b.final_score?.rate * 100 || 0).toFixed(1)}%`);
row("passed/total", `${a.final_score?.passed}/${a.final_score?.total}`, `${b.final_score?.passed}/${b.final_score?.total}`);
row("tasks done", `${countTasksDone(a.tasks)}/${a.tasks?.length ?? "?"}`, `${countTasksDone(b.tasks)}/${b.tasks?.length ?? "?"}`);
row("merge conflicts", a.merge_conflict_count, b.merge_conflict_count);
row("scope violations", a.scope_violation_count, b.scope_violation_count);
row("cross-scope changes", a.cross_scope_change_count, b.cross_scope_change_count);
row("integration fixes", a.integration_fix_count, b.integration_fix_count);
row("commits", a.commits, b.commits);
row("loc", a.loc, b.loc);
row("agent calls", a.agent_calls?.length, b.agent_calls?.length);
const aMs = a.agent_calls?.reduce((s, c) => s + (c.elapsedMs || 0), 0) || 0;
const bMs = b.agent_calls?.reduce((s, c) => s + (c.elapsedMs || 0), 0) || 0;
row("agent time (ms)", aMs, bMs);
console.log("");
