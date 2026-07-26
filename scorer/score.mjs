#!/usr/bin/env node
/**
 * Score workspace CommonMark renderer against spec/examples.json.
 *
 * Contract: workspace provides `node dist/cli.js` (stdin markdown → stdout HTML).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXAMPLES_PATH = path.join(ROOT, "spec", "examples.json");

function parseArgs(argv) {
  const args = {
    workspace: path.join(ROOT, "workspace"),
    json: null,
    limit: null,
    sections: null,
    ids: null,
    holdoutFile: null,
    holdoutMode: "include",
    truncate: 300,
    maxFailures: 20,
    examples: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--workspace" || a === "-w") args.workspace = path.resolve(argv[++i]);
    else if (a === "--json") args.json = path.resolve(argv[++i]);
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--sections") {
      args.sections = String(argv[++i] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--ids") {
      args.ids = String(argv[++i] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--holdout-file") {
      args.holdoutFile = path.resolve(argv[++i]);
    } else if (a === "--holdout-mode") {
      args.holdoutMode = String(argv[++i] || "include");
    } else if (a === "--truncate") {
      args.truncate = Number(argv[++i]);
    } else if (a === "--max-failures") {
      args.maxFailures = Number(argv[++i]);
    } else if (a === "--examples") {
      args.examples = path.resolve(argv[++i]);
    } else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scorer/score.mjs [--workspace dir] [--json out.json] [--limit N]
  [--sections "A,B"] [--ids a,b] [--holdout-file path] [--holdout-mode exclude|only|include]
  [--examples path] [--truncate N] [--max-failures N]`);
      process.exit(0);
    }
  }
  if (!["include", "exclude", "only"].includes(args.holdoutMode)) {
    console.error(`Invalid --holdout-mode=${args.holdoutMode}`);
    process.exit(2);
  }
  return args;
}

function normalizeOutput(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/\n+$/, "");
}

function truncate(text, n) {
  const s = String(text ?? "");
  if (!Number.isFinite(n) || n <= 0) return s;
  return s.length <= n ? s : s.slice(0, n);
}

function renderMarkdown(cwd, markdown) {
  const cli = path.join(cwd, "dist", "cli.js");
  if (!existsSync(cli)) {
    return { ok: false, error: `Missing ${cli}. Run npm run build in workspace.` };
  }
  const result = spawnSync(process.execPath, [cli], {
    cwd,
    input: markdown,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30_000,
  });
  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || result.stdout || "cli failed").trim() };
  }
  return { ok: true, html: result.stdout };
}

function scoreWorkspace(workspaceDir, examples, { limit, truncateChars, maxFailures }) {
  const subset = limit ? examples.slice(0, limit) : examples;
  const sectionStats = {};
  let passed = 0;
  const failures = [];

  for (const ex of subset) {
    const rendered = renderMarkdown(workspaceDir, ex.markdown);
    if (!rendered.ok) {
      failures.push({
        id: ex.id,
        section: ex.section,
        reason: rendered.error,
        markdown: truncate(ex.markdown, truncateChars),
      });
      sectionStats[ex.section] = sectionStats[ex.section] || { passed: 0, total: 0 };
      sectionStats[ex.section].total += 1;
      continue;
    }
    const expected = normalizeOutput(ex.html);
    const actual = normalizeOutput(rendered.html);
    const ok = actual === expected;
    sectionStats[ex.section] = sectionStats[ex.section] || { passed: 0, total: 0 };
    sectionStats[ex.section].total += 1;
    if (ok) {
      passed += 1;
      sectionStats[ex.section].passed += 1;
    } else {
      failures.push({
        id: ex.id,
        section: ex.section,
        reason: "output mismatch",
        markdown: truncate(ex.markdown, truncateChars),
        expected: truncate(expected, truncateChars),
        actual: truncate(actual, truncateChars),
      });
    }
  }

  const total = subset.length;
  const bySection = {};
  for (const [name, st] of Object.entries(sectionStats)) {
    bySection[name] = {
      passed: st.passed,
      total: st.total,
      rate: st.total ? st.passed / st.total : 0,
    };
  }

  return {
    scored_at: new Date().toISOString(),
    workspace: workspaceDir,
    total,
    passed,
    rate: total ? passed / total : 0,
    by_section: bySection,
    failures: failures.slice(0, Math.max(0, maxFailures)),
    failure_count: failures.length,
  };
}

const args = parseArgs(process.argv.slice(2));
const examplesPath = args.examples || EXAMPLES_PATH;
if (!existsSync(examplesPath)) {
  console.error(`Missing examples file: ${examplesPath}`);
  if (!args.examples) console.error("Run: npm run spec:extract");
  process.exit(1);
}
let examples = JSON.parse(readFileSync(examplesPath, "utf8"));
if (args.sections?.length) {
  const sectionSet = new Set(args.sections);
  examples = examples.filter((e) => sectionSet.has(e.section));
}
if (args.ids?.length) {
  const idSet = new Set(args.ids);
  examples = examples.filter((e) => idSet.has(e.id));
}
if (args.holdoutFile && args.holdoutMode !== "include") {
  if (!existsSync(args.holdoutFile)) {
    console.error(`Missing holdout file: ${args.holdoutFile}`);
    process.exit(2);
  }
  let holdoutIds = [];
  try {
    const ho = JSON.parse(readFileSync(args.holdoutFile, "utf8"));
    holdoutIds = Array.isArray(ho.ids) ? ho.ids : [];
  } catch {
    console.error(`Invalid holdout file: ${args.holdoutFile}`);
    process.exit(2);
  }
  const holdoutSet = new Set(holdoutIds);
  if (args.holdoutMode === "exclude") {
    examples = examples.filter((e) => !holdoutSet.has(e.id));
  } else if (args.holdoutMode === "only") {
    examples = examples.filter((e) => holdoutSet.has(e.id));
  }
}

const report = scoreWorkspace(args.workspace, examples, {
  limit: args.limit,
  truncateChars: args.truncate,
  maxFailures: args.maxFailures,
});

if (args.json) {
  writeFileSync(args.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Score report → ${args.json}`);
}

console.log(`Pass rate: ${report.passed}/${report.total} (${(report.rate * 100).toFixed(1)}%)`);
if (report.failure_count > 0) {
  console.log(`Failures (first ${Math.min(5, report.failures.length)}):`);
  for (const f of report.failures.slice(0, 5)) {
    console.log(`  - ${f.id} [${f.section}]: ${f.reason}`);
  }
}

process.exit(report.total > 0 && report.passed === report.total ? 0 : 1);
