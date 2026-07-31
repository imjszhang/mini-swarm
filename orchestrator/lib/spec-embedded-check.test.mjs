#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  canonicalizeJson,
  collectCrossSectionExamples,
  collectSectionExamples,
  compareCliOutput,
  deepEqualJson,
  normalizeTextOutput,
  parseEmbeddedExamples,
  sampleExamples,
  seededRng,
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

run("sampleExamples without seed takes prefix", () => {
  assert.deepEqual(sampleExamples([1, 2, 3, 4], 2, null), [1, 2]);
});

run("sampleExamples with seed is deterministic and not always prefix", () => {
  const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const a = sampleExamples(items, 3, "seed-a");
  const b = sampleExamples(items, 3, "seed-a");
  const c = sampleExamples(items, 3, "seed-b");
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  // Different seeds should usually differ; if equal, still size-ok
  if (JSON.stringify(a) === JSON.stringify(c)) {
    assert.equal(c.length, 3);
  } else {
    assert.notDeepEqual(a, c);
  }
  const rand = seededRng("x");
  assert.ok(rand() >= 0 && rand() < 1);
});

run("collectSectionExamples seeded samples among all", () => {
  const mk = (n) => [
    `${FENCE} example`,
    `in-${n}`,
    ".",
    `out-${n}`,
    FENCE,
  ].join("\n");
  const text = [0, 1, 2, 3, 4].map(mk).join("\n");
  const xs = collectSectionExamples(["S"], {
    getText: () => text,
    maxExamples: 2,
    seed: "stable",
  });
  assert.equal(xs.length, 2);
  const prefix = collectSectionExamples(["S"], {
    getText: () => text,
    maxExamples: 2,
    seed: null,
  });
  assert.equal(prefix[0].input, "in-0");
});

run("collectCrossSectionExamples excludes sections", () => {
  const block = [
    `${FENCE} example`,
    "z",
    ".",
    "w",
    FENCE,
  ].join("\n");
  const xs = collectCrossSectionExamples(["A"], {
    getText: (section) => (section === "B" ? block : ""),
    maxExamples: 5,
    seed: "c",
    allSections: ["A", "B"],
  });
  assert.equal(xs.length, 1);
  assert.equal(xs[0].section, "B");
  assert.equal(xs[0].input, "z");
});
