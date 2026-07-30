#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  canonicalizeJson,
  collectSectionExamples,
  compareCliOutput,
  deepEqualJson,
  normalizeTextOutput,
  parseEmbeddedExamples,
} from "./spec-embedded-check.mjs";

const FENCE = "`".repeat(32);

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

run("parseEmbeddedExamples valid + ERROR", () => {
  const text = [
    `${FENCE} example`,
    "a = 1",
    ".",
    '{"a":{"type":"integer","value":"1"}}',
    FENCE,
    "",
    `${FENCE} example`,
    "bad = [",
    ".",
    "ERROR",
    FENCE,
  ].join("\n");
  const xs = parseEmbeddedExamples(text);
  assert.equal(xs.length, 2);
  assert.equal(xs[0].input, "a = 1");
  assert.equal(xs[0].expectError, false);
  assert.equal(xs[1].expectError, true);
});

run("deepEqualJson ignores key order", () => {
  assert.equal(
    deepEqualJson({ b: 1, a: 2 }, { a: 2, b: 1 }),
    true,
  );
  assert.equal(
    deepEqualJson({ a: { z: 1, y: 2 } }, { a: { y: 2, z: 1 } }),
    true,
  );
  assert.equal(deepEqualJson({ a: 1 }, { a: 2 }), false);
});

run("compareCliOutput toml vs html", () => {
  const tomlOk = compareCliOutput(
    '{"b":1,"a":2}',
    '{"a":2,"b":1}',
    "toml-json",
  );
  assert.equal(tomlOk.ok, true);

  const htmlOk = compareCliOutput(
    "<p>hi</p>\n",
    "<p>hi</p>",
    "commonmark",
  );
  assert.equal(htmlOk.ok, true);

  const htmlBad = compareCliOutput("<p>a</p>", "<p>b</p>", "commonmark");
  assert.equal(htmlBad.ok, false);
});

run("normalizeTextOutput strips trailing ws", () => {
  assert.equal(normalizeTextOutput("a  \n\n"), "a");
});

run("canonicalizeJson sorts nested keys", () => {
  assert.deepEqual(
    canonicalizeJson({ z: 1, a: { c: 2, b: 3 } }),
    { a: { b: 3, c: 2 }, z: 1 },
  );
});

run("collectSectionExamples respects max and getText", () => {
  const block = [
    `${FENCE} example`,
    "x",
    ".",
    "y",
    FENCE,
  ].join("\n");
  const xs = collectSectionExamples(["A", "B"], {
    getText: () => `${block}\n${block}`,
    maxExamples: 3,
  });
  assert.equal(xs.length, 3);
});
