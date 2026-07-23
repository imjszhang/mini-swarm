#!/usr/bin/env node
/**
 * Validate scorer against reference commonmark npm package (dev only).
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(ROOT, "scorer", ".fixture-workspace");

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
const score = spawnSync(process.execPath, [
  "scorer/score.mjs",
  "--workspace", FIXTURE,
  "--limit", "50",
], { cwd: ROOT, encoding: "utf8" });

console.log(score.stdout || score.stderr);
const m = /Pass rate: (\d+)\/(\d+)/.exec(score.stdout || "");
const passed = m ? Number(m[1]) : 0;
if (score.status !== 0 && passed < 30) {
  console.error("Scorer validation failed on first 50 examples.");
  process.exit(1);
}
console.log(`Scorer validation OK (reference impl ${passed}/50; tabs may differ from spec).`);
