#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  attachEngineeringError,
  createRepairBudget,
  formatEngineeringError,
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
