#!/usr/bin/env node
/**
 * Generate runs/<id>/REPORT.md from metrics + scores, with optional CommonMark baseline compare.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./lib/config.mjs";
import { activeWallMinutes } from "./metrics.mjs";

function parseArgs(argv) {
  const args = { runId: null, baseline: "run-swarm-v13.3", help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--run-id") args.runId = argv[++i];
    else if (a.startsWith("--run-id=")) args.runId = a.slice("--run-id=".length);
    else if (a === "--baseline") args.baseline = argv[++i];
    else if (a.startsWith("--baseline=")) args.baseline = a.slice("--baseline=".length);
  }
  return args;
}

function pct(rate) {
  if (rate == null || Number.isNaN(rate)) return "n/a";
  return `${(rate * 100).toFixed(1)}%`;
}

function loadJson(p) {
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

function tokenTotals(m) {
  const calls = m.agent_calls || [];
  let tin = 0;
  let tout = 0;
  let cache = 0;
  for (const c of calls) {
    tin += Number(c.tokens_in || c.usage?.input_tokens || 0);
    tout += Number(c.tokens_out || c.usage?.output_tokens || 0);
    cache += Number(c.tokens_cache || c.usage?.cache_read_tokens || 0);
  }
  return { tin, tout, cache, n: calls.length };
}

function taskDurations(m) {
  const tasks = Array.isArray(m.tasks) ? m.tasks : [];
  const ms = tasks.map((t) => t.elapsedMs).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!ms.length) return null;
  const sum = ms.reduce((a, b) => a + b, 0);
  const mid = ms[Math.floor(ms.length / 2)];
  return {
    n: ms.length,
    mean_min: +(sum / ms.length / 60000).toFixed(2),
    p50_min: +(mid / 60000).toFixed(2),
    max_min: +(ms[ms.length - 1] / 60000).toFixed(2),
  };
}

function zeroObserveCount(m) {
  return (m.score_curve || []).filter((p) => (p.total || 0) > 0 && (p.passed || 0) === 0).length;
}

function conflictHotspots(m) {
  const hist = {};
  for (const c of m.merge_conflicts || []) {
    for (const f of c.files || []) hist[f] = (hist[f] || 0) + 1;
  }
  return Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 8);
}

function weakSections(score, n = 8) {
  const entries = Object.entries(score?.by_section || score?.by_group || {})
    .map(([g, v]) => ({ g, rate: v.rate ?? 0, miss: (v.total || 0) - (v.passed || 0), total: v.total || 0 }))
    .filter((x) => x.miss > 0)
    .sort((a, b) => b.miss - a.miss || a.rate - b.rate);
  return entries.slice(0, n);
}

function failBuckets(score) {
  const fails = score?.failures || [];
  let expectErrorAccepted = 0;
  let mismatch = 0;
  let other = 0;
  for (const f of fails) {
    const r = String(f.reason || "");
    if (r.includes("invalid input accepted") || r.includes("non-zero")) expectErrorAccepted += 1;
    else if (r.includes("mismatch")) mismatch += 1;
    else other += 1;
  }
  return { n: fails.length, expectErrorAccepted, mismatch, other };
}

function stopReason(consoleLog) {
  if (!consoleLog) return "unknown";
  if (consoleLog.includes("planner declared done")) return "planner_done";
  if (consoleLog.includes("idle tree")) return "idle_tree";
  if (consoleLog.includes("wall-clock budget exhausted")) return "wall_budget";
  return "other";
}

function row(label, a, b) {
  return `| ${label} | ${a} | ${b} |`;
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help || !cli.runId) {
    console.log("Usage: node orchestrator/report-task-run.mjs --run-id=ID [--baseline=run-swarm-v13.3]");
    process.exit(cli.help ? 0 : 1);
  }
  const root = projectRoot();
  const runDir = path.join(root, "runs", cli.runId);
  const m = loadJson(path.join(runDir, "metrics.json"));
  if (!m) {
    console.error(`missing metrics: ${runDir}`);
    process.exit(1);
  }
  const full = loadJson(path.join(runDir, "score-full.json")) || m.final_score;
  const visible = loadJson(path.join(runDir, "score-visible.json")) || m.visible_score;
  const holdout = loadJson(path.join(runDir, "score-holdout.json")) || m.holdout_score;
  const tree = loadJson(path.join(runDir, "tree.json"));
  const consoleLog = existsSync(path.join(runDir, "console.log"))
    ? readFileSync(path.join(runDir, "console.log"), "utf8")
    : "";

  const baseDir = path.join(root, "runs", cli.baseline);
  const bm = loadJson(path.join(baseDir, "metrics.json"));
  const bfull = loadJson(path.join(baseDir, "score-full.json")) || bm?.final_score;

  const tokens = tokenTotals(m);
  const durs = taskDurations(m);
  const stats = m.tree_stats || {};
  const leavesDone = stats.done ?? 0;
  const leavesTotal = stats.leaves ?? 0;
  const wall = activeWallMinutes(m);
  const cm = m.core_metrics || {};
  const eff = cm.effective_parallelism ?? cm.eff_parallelism;

  const lines = [];
  lines.push(`# Report: ${cli.runId}`);
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## 1. Experiment metadata");
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| task_pack | ${m.task_pack || "n/a"} |`);
  lines.push(`| run_id | ${cli.runId} |`);
  lines.push(`| protocol | zero-signal swarm v13.3; run_to_done=${!!m.run_to_done} |`);
  lines.push(`| concurrency | ${m.swarm?.concurrency ?? "n/a"} |`);
  lines.push(`| models | planner/worker from config (see agent_calls) |`);
  lines.push(`| started / finished | ${m.started_at || "?"} / ${m.finished_at || "?"} |`);
  lines.push(`| segments | ${(m.segments || []).length} |`);
  lines.push(`| active wall (min) | ${wall.toFixed(1)} |`);
  lines.push(`| stop reason | ${stopReason(consoleLog)} |`);
  lines.push(`| finalized / salvaged | ${!!m.finalized} / ${!!m.salvaged} |`);
  lines.push("");
  lines.push("## 2. Core metrics");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| leaf done / total | ${leavesDone} / ${leavesTotal} (${leavesTotal ? ((leavesDone / leavesTotal) * 100).toFixed(1) : 0}%) |`);
  lines.push(`| task time mean / p50 / max (min) | ${durs ? `${durs.mean_min} / ${durs.p50_min} / ${durs.max_min}` : "n/a"} |`);
  lines.push(`| tokens in+out (+cache) | ${(tokens.tin + tokens.tout).toLocaleString()} (+${tokens.cache.toLocaleString()}) across ${tokens.n} calls |`);
  lines.push(`| wall (active min) | ${wall.toFixed(1)} |`);
  lines.push(`| effective_parallelism | ${eff ?? "n/a"} |`);
  lines.push("");
  lines.push("## 3. Quality");
  lines.push("");
  lines.push(`| Score | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| full | ${pct(full?.rate)} (${full?.passed}/${full?.total}) |`);
  lines.push(`| visible | ${pct(visible?.rate)} (${visible?.passed}/${visible?.total}) |`);
  lines.push(`| holdout | ${pct(holdout?.rate)} (${holdout?.passed}/${holdout?.total}) |`);
  lines.push(`| holdout_gap_pp | ${m.holdout_gap_pp ?? "n/a"} |`);
  lines.push(`| overfit_alarm | ${!!m.overfit_alarm} |`);
  lines.push("");
  const weak = weakSections(full);
  lines.push("### Weak sections (by misses)");
  lines.push("");
  if (!weak.length) lines.push("_None._");
  else {
    lines.push("| Section | missed | rate |");
    lines.push("|---|---|---|");
    for (const w of weak) lines.push(`| ${w.g} | ${w.miss}/${w.total} | ${pct(w.rate)} |`);
  }
  lines.push("");
  const buckets = failBuckets(full);
  lines.push("### Failure buckets (from scored failure sample)");
  lines.push("");
  lines.push(`| Bucket | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| total failure_count | ${full?.failure_count ?? buckets.n} |`);
  lines.push(`| valid output mismatch (sample) | ${buckets.mismatch} |`);
  lines.push(`| invalid accepted (sample) | ${buckets.expectErrorAccepted} |`);
  lines.push(`| other (sample) | ${buckets.other} |`);
  lines.push("");
  lines.push("## 4. Process health");
  lines.push("");
  lines.push(`| Signal | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| merge_conflict_count | ${m.merge_conflict_count ?? (m.merge_conflicts || []).length} |`);
  lines.push(`| zero-pass observe windows | ${zeroObserveCount(m)} |`);
  lines.push(`| planner_parse_failures | ${m.planner_parse_failures || 0} |`);
  lines.push(`| planner_rounds | ${m.swarm_planner_rounds ?? tree?.planner_rounds ?? "n/a"} |`);
  lines.push(`| self_check_total | ${m.self_check_total || 0} |`);
  lines.push(`| reviews | ${(m.reviews || []).length} |`);
  lines.push("");
  const hot = conflictHotspots(m);
  lines.push("### Conflict hotspots");
  lines.push("");
  if (!hot.length) lines.push("_None._");
  else {
    lines.push("| File | conflicts |");
    lines.push("|---|---|");
    for (const [f, n] of hot) lines.push(`| ${f} | ${n} |`);
  }
  lines.push("");
  lines.push("## 5. Baseline compare");
  lines.push("");
  lines.push(`Baseline: \`${cli.baseline}\` (CommonMark v13.3 unless overridden).`);
  lines.push("");
  lines.push(`| Metric | ${cli.runId} | ${cli.baseline} |`);
  lines.push(`|---|---|---|`);
  lines.push(row("task_pack", m.task_pack || "?", bm?.task_pack || "commonmark"));
  lines.push(row("full", pct(full?.rate), pct(bfull?.rate)));
  lines.push(row("visible", pct(visible?.rate), pct(bm?.visible_score?.rate ?? loadJson(path.join(baseDir, "score-visible.json"))?.rate)));
  lines.push(row("holdout", pct(holdout?.rate), pct(bm?.holdout_score?.rate ?? loadJson(path.join(baseDir, "score-holdout.json"))?.rate)));
  lines.push(row("conflicts", String(m.merge_conflict_count ?? (m.merge_conflicts || []).length), String(bm?.merge_conflict_count ?? (bm?.merge_conflicts || []).length)));
  lines.push(row("zero-pass observe", String(zeroObserveCount(m)), String(bm ? zeroObserveCount(bm) : "n/a")));
  lines.push(row("active wall min", wall.toFixed(1), bm ? activeWallMinutes(bm).toFixed(1) : "n/a"));
  lines.push(row("self_check", String(m.self_check_total || 0), String(bm?.self_check_total || 0)));
  lines.push("");
  lines.push("## 6. Conclusion");
  lines.push("");
  const fullOk = (full?.rate ?? 0) >= 0.9;
  const gapOk = m.holdout_gap_pp == null || Math.abs(m.holdout_gap_pp) < 5;
  const zeroOk = zeroObserveCount(m) === 0;
  lines.push(`- Success bar full≥90%: **${fullOk ? "PASS" : "FAIL"}** (${pct(full?.rate)})`);
  lines.push(`- holdout gap &lt; 5pp: **${gapOk ? "PASS" : "FAIL"}** (${m.holdout_gap_pp ?? "n/a"})`);
  lines.push(`- zero-pass observe = 0: **${zeroOk ? "PASS" : "FAIL"}**`);
  lines.push(`- Migration proposition (high platform + healthy process on second sample): **${fullOk && zeroOk ? "SUPPORTED" : "MIXED / NOT YET"}**`);
  lines.push("");
  lines.push("Compare command:");
  lines.push("");
  lines.push("```bash");
  lines.push(`npm run compare -- runs/${cli.baseline}/metrics.json runs/${cli.runId}/metrics.json`);
  lines.push("```");
  lines.push("");

  const out = path.join(runDir, "REPORT.md");
  writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
  console.log(`[report] wrote ${out}`);
}

main();
