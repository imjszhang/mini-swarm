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
  const args = { workspace: path.join(ROOT, "workspace"), json: null, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--workspace" || a === "-w") args.workspace = path.resolve(argv[++i]);
    else if (a === "--json") args.json = path.resolve(argv[++i]);
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scorer/score.mjs [--workspace dir] [--json out.json] [--limit N]`);
      process.exit(0);
    }
  }
  return args;
}

function normalizeOutput(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/\n+$/, "");
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

function scoreWorkspace(workspaceDir, examples, limit) {
  const subset = limit ? examples.slice(0, limit) : examples;
  const sectionStats = {};
  let passed = 0;
  const failures = [];

  for (const ex of subset) {
    const rendered = renderMarkdown(workspaceDir, ex.markdown);
    if (!rendered.ok) {
      failures.push({ id: ex.id, section: ex.section, reason: rendered.error });
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
        expected: expected.slice(0, 200),
        actual: actual.slice(0, 200),
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
    failures: failures.slice(0, 20),
    failure_count: failures.length,
  };
}

const args = parseArgs(process.argv.slice(2));
if (!existsSync(EXAMPLES_PATH)) {
  console.error("Missing spec/examples.json. Run: npm run spec:extract");
  process.exit(1);
}
const examples = JSON.parse(readFileSync(EXAMPLES_PATH, "utf8"));
const report = scoreWorkspace(args.workspace, examples, args.limit);

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
