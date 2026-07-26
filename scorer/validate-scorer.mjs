#!/usr/bin/env node
/**
 * Validate scorer against reference commonmark npm package.
 * Requires 100% of in-scope examples minus any entries in
 * spec/oracle-exceptions.json (human-reviewed; expected empty).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(ROOT, "scorer", ".fixture-workspace");
const EXCEPTIONS_PATH = path.join(ROOT, "spec", "oracle-exceptions.json");

function setupFixture() {
  rmSync(FIXTURE, { recursive: true, force: true });
  mkdirSync(path.join(FIXTURE, "dist"), { recursive: true });
  writeFileSync(path.join(FIXTURE, "package.json"), JSON.stringify({
    name: "fixture-commonmark",
    type: "module",
    scripts: { build: "node -e \"console.log('ok')\"" },
    dependencies: { commonmark: "^0.31.2" },
  }, null, 2));
  writeFileSync(path.join(FIXTURE, "dist", "cli.js"), `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const commonmark = require("commonmark");
const reader = new commonmark.Parser();
const writer = new commonmark.HtmlRenderer();
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const parsed = reader.parse(input);
  process.stdout.write(writer.render(parsed));
});
`);
  const npm = spawnSync("npm", ["install"], { cwd: FIXTURE, encoding: "utf8", shell: true });
  if (npm.status !== 0) {
    console.error(npm.stderr || npm.stdout);
    process.exit(1);
  }
}

if (!existsSync(path.join(ROOT, "spec", "examples.json"))) {
  spawnSync(process.execPath, ["spec/extract.mjs"], { cwd: ROOT, stdio: "inherit" });
}

setupFixture();

const scoreJson = path.join(FIXTURE, "score-full.json");
const score = spawnSync(process.execPath, [
  "scorer/score.mjs",
  "--workspace", FIXTURE,
  "--json", scoreJson,
  "--max-failures", "600",
], { cwd: ROOT, encoding: "utf8" });

console.log(score.stdout || score.stderr);

let report;
try {
  report = JSON.parse(readFileSync(scoreJson, "utf8"));
} catch {
  console.error("Scorer validation failed: could not parse score report.");
  process.exit(1);
}

let exceptions = [];
if (existsSync(EXCEPTIONS_PATH)) {
  try {
    exceptions = JSON.parse(readFileSync(EXCEPTIONS_PATH, "utf8"));
    if (!Array.isArray(exceptions)) exceptions = [];
  } catch {
    exceptions = [];
  }
}
const exceptionIds = new Set(exceptions.map((e) => e.id).filter(Boolean));
const failingIds = (report.failures || []).map((f) => f.id);
const unexplained = failingIds.filter((id) => !exceptionIds.has(id));
const allowedFail = report.total - exceptionIds.size;

console.log(
  `Reference impl: ${report.passed}/${report.total}; exceptions=${exceptionIds.size}; unexplained_fails=${unexplained.length}`,
);
if (unexplained.length) {
  console.error("Unexplained failures (first 10):", unexplained.slice(0, 10));
  console.error("Scorer validation FAILED — reference must pass all in-scope examples minus oracle-exceptions.");
  process.exit(1);
}
if (report.passed < allowedFail) {
  console.error(`Scorer validation FAILED: passed ${report.passed} < allowed ${allowedFail}`);
  process.exit(1);
}
console.log("Scorer validation OK (reference impl covers in-scope suite minus exceptions).");
