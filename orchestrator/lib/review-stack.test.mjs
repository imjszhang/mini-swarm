#!/usr/bin/env node
import assert from "node:assert/strict";
import { resolveReviewDiffRef } from "./review-stack.mjs";

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

run("resolveReviewDiffRef accepts full SHA", () => {
  const sha = "a".repeat(40);
  assert.equal(resolveReviewDiffRef(sha), sha);
});

run("resolveReviewDiffRef accepts short SHA", () => {
  assert.equal(resolveReviewDiffRef("e807a8e"), "e807a8e");
});

run("resolveReviewDiffRef falls back when missing", () => {
  assert.equal(resolveReviewDiffRef(null), "HEAD~1");
  assert.equal(resolveReviewDiffRef(""), "HEAD~1");
  assert.equal(resolveReviewDiffRef("  "), "HEAD~1");
});

run("resolveReviewDiffRef rejects non-hex", () => {
  assert.equal(resolveReviewDiffRef("HEAD~5"), "HEAD~1");
  assert.equal(resolveReviewDiffRef("not-a-sha"), "HEAD~1");
});
