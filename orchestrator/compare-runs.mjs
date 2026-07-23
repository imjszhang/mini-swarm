#!/usr/bin/env node
/**
 * Compare two run metrics.json files (Run A vs Run B).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) {
  console.log("Usage: node orchestrator/compare-runs.mjs runs/run-a/metrics.json runs/run-b/metrics.json");
  process.exit(1);
}

function load(p) {
  return JSON.parse(readFileSync(path.resolve(p), "utf8"));
}

const a = load(aPath);
const b = load(bPath);

function row(label, va, vb) {
  console.log(`${label.padEnd(22)} ${String(va).padEnd(18)} ${String(vb)}`);
}

console.log("\n=== mini-swarm A/B comparison ===\n");
row("Metric", "Run A", "Run B");
row("coordination", a.coordination, b.coordination);
row("pass rate", `${(a.final_score?.rate * 100 || 0).toFixed(1)}%`, `${(b.final_score?.rate * 100 || 0).toFixed(1)}%`);
row("passed/total", `${a.final_score?.passed}/${a.final_score?.total}`, `${b.final_score?.passed}/${b.final_score?.total}`);
row("conflicts", a.conflict_count, b.conflict_count);
row("commits", a.commits, b.commits);
row("loc", a.loc, b.loc);
row("agent calls", a.agent_calls?.length, b.agent_calls?.length);
const aMs = a.agent_calls?.reduce((s, c) => s + (c.elapsedMs || 0), 0) || 0;
const bMs = b.agent_calls?.reduce((s, c) => s + (c.elapsedMs || 0), 0) || 0;
row("agent time (ms)", aMs, bMs);
console.log("");
