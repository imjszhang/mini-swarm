#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  attachEngineeringError,
  buildHealthRepairPrompt,
  createRepairBudget,
  formatEngineeringError,
  formatHealthRepairContext,
  truncateStderr,
} from "./swarm-health.mjs";

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

run("formatEngineeringError includes phase kind taskId", () => {
  const msg = formatEngineeringError({
    phase: "post-merge",
    kind: "canary",
    stderr: "boom\nline2",
    taskId: "task-01",
  });
  assert.match(msg, /^task-01: post-merge canary failed:/);
  assert.match(msg, /boom/);
});

run("truncateStderr ellipsis", () => {
  const s = truncateStderr("x".repeat(50), 10);
  assert.equal(s.length, 11); // 10 + …
  assert.ok(s.endsWith("…"));
});

run("attachEngineeringError blocks report", () => {
  const { report, engineeringError } = attachEngineeringError(
    { status: "done", summary: "ok", self_checked: 3 },
    { phase: "pre-merge", kind: "build", stderr: "tsc fail", taskId: "t1" },
  );
  assert.equal(report.status, "blocked");
  assert.match(report.summary, /pre-merge build failed/);
  assert.equal(report.engineering.kind, "build");
  assert.equal(engineeringError.kind, "build");
  assert.match(engineeringError.message, /t1:/);
});

run("createRepairBudget shared pool", () => {
  const b = createRepairBudget(1);
  assert.equal(b.repairsLeft, 1);
  assert.equal(b.consume(), true);
  assert.equal(b.repairsLeft, 0);
  assert.equal(b.consume(), false);
  assert.equal(createRepairBudget(0).consume(), false);
});

run("formatHealthRepairContext includes DESIGN and diff", () => {
  const ctx = formatHealthRepairContext({
    designMd: "# D-01 use Map",
    diff: "diff --git a/src/x.ts b/src/x.ts\n+export const x = 1;",
  });
  assert.match(ctx, /## DESIGN\.md/);
  assert.match(ctx, /D-01 use Map/);
  assert.match(ctx, /## Recent diff/);
  assert.match(ctx, /src\/x\.ts/);
  assert.doesNotMatch(ctx, /cross-scope/);
});

run("formatHealthRepairContext includes cross-scope when present", () => {
  const ctx = formatHealthRepairContext({
    designMd: "d",
    diff: "diff",
    crossScopeLog: "abc1234 cross-scope: roll back date parser",
  });
  assert.match(ctx, /Recent cross-scope commits/);
  assert.match(ctx, /roll back date parser/);
});

run("buildHealthRepairPrompt embeds context for build failures", () => {
  const prompt = buildHealthRepairPrompt({
    kind: "build",
    stderr: "error TS2304: Cannot find name 'Foo'",
    phase: "post-merge-gate",
    designMd: "## Decisions\nD-10 reject signed hex",
    diff: "+export type Foo = number;",
    crossScopeLog: "deadbeef cross-scope: shared Foo type",
  });
  assert.match(prompt, /Cannot find name 'Foo'/);
  assert.match(prompt, /D-10 reject signed hex/);
  assert.match(prompt, /export type Foo/);
  assert.match(prompt, /shared Foo type/);
  assert.match(prompt, /INTEGRATION_FIXED/);
});

run("buildHealthRepairPrompt embeds context for embedded failures", () => {
  const prompt = buildHealthRepairPrompt({
    kind: "embedded",
    stderr: "1/5 embedded example(s) failed",
    phase: "pre-merge",
    designMd: "DESIGN body",
    diff: "diff body",
  });
  assert.match(prompt, /embedded example/);
  assert.match(prompt, /DESIGN body/);
  assert.match(prompt, /diff body/);
});
