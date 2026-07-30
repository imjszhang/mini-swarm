#!/usr/bin/env node
import assert from "node:assert/strict";
import { normalizeMaxTokensInOut } from "./config.mjs";
import { totalTokensInOut } from "../metrics.mjs";

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

run("normalizeMaxTokensInOut treats null/0 as unlimited", () => {
  assert.equal(normalizeMaxTokensInOut(null), null);
  assert.equal(normalizeMaxTokensInOut(undefined), null);
  assert.equal(normalizeMaxTokensInOut(0), null);
  assert.equal(normalizeMaxTokensInOut(-5), null);
  assert.equal(normalizeMaxTokensInOut(""), null);
  assert.equal(normalizeMaxTokensInOut("abc"), null);
});

run("normalizeMaxTokensInOut keeps positive integers", () => {
  assert.equal(normalizeMaxTokensInOut(1), 1);
  assert.equal(normalizeMaxTokensInOut(1_000_000), 1_000_000);
  assert.equal(normalizeMaxTokensInOut(12.9), 12);
  assert.equal(normalizeMaxTokensInOut("500"), 500);
});

run("totalTokensInOut sums in+out and ignores cache", () => {
  const n = totalTokensInOut({
    agent_calls: [
      { tokens_in: 10, tokens_out: 5, tokens_cache_read: 999 },
      { tokens_in: 3, tokens_out: 2 },
      { role: "worker" },
    ],
  });
  assert.equal(n, 20);
});

run("totalTokensInOut empty is zero", () => {
  assert.equal(totalTokensInOut(null), 0);
  assert.equal(totalTokensInOut({}), 0);
  assert.equal(totalTokensInOut({ agent_calls: [] }), 0);
});

if (process.exitCode) {
  console.error("FAIL");
  process.exit(1);
}
console.log("all token-budget tests passed");
