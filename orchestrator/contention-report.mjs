#!/usr/bin/env node
/**
 * Aggregate file-level contention signals from a metrics.json into
 * runs/{id}/contention-report.json (sorted by hit count desc).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const metricsPath = process.argv[2];
if (!metricsPath) {
  console.log("Usage: node orchestrator/contention-report.mjs runs/<id>/metrics.json");
  console.log("   or: npm run contention:report -- runs/<id>/metrics.json");
  process.exit(1);
}

const abs = path.resolve(metricsPath);
if (!existsSync(abs)) {
  console.error(`Missing metrics: ${abs}`);
  process.exit(1);
}

const metrics = JSON.parse(readFileSync(abs, "utf8"));
const counts = new Map();

function bump(file, source) {
  if (!file) return;
  const key = String(file).replace(/\\/g, "/");
  const prev = counts.get(key) || { file: key, count: 0, sources: {} };
  prev.count += 1;
  prev.sources[source] = (prev.sources[source] || 0) + 1;
  counts.set(key, prev);
}

for (const e of metrics.worktree_syncs || []) {
  for (const f of e.files || []) bump(f, "worktree_sync");
}
for (const e of metrics.merge_conflicts || []) {
  for (const f of e.files || []) bump(f, "merge_conflict");
  if (e.file) bump(e.file, "merge_conflict");
}
for (const e of metrics.cross_scope_changes || []) {
  for (const f of e.files || []) bump(f, "cross_scope");
}

const files = [...counts.values()].sort((a, b) => b.count - a.count);
const out = {
  source_metrics: abs,
  generated_at: new Date().toISOString(),
  files,
};
const outPath = path.join(path.dirname(abs), "contention-report.json");
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
console.log(`Contention report → ${outPath} (${files.length} files)`);
if (files.length) {
  console.log("Top:", files.slice(0, 10).map((f) => `${f.file}:${f.count}`).join(", "));
}
