#!/usr/bin/env node
/**
 * Build a compact normative spec.txt with embedded examples for worker self-check.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examples = JSON.parse(readFileSync(path.join(PACK, "spec", "examples.json"), "utf8"));
const sections = JSON.parse(readFileSync(path.join(PACK, "spec", "sections.json"), "utf8"));
const fence = "`".repeat(32);

const INTRO = `# TOML v1.0 Decoder (experiment subset)

This document is the normative reference for the mini-swarm toml-json task.
Implement a decoder that:

- Accepts TOML on stdin.
- On valid input: exit 0 and print toml-test tagged JSON on stdout.
- On invalid input: exit non-zero.

Tagged values look like \`{"type":"string","value":"hi"}\` (see toml-test).
Do not consult \`examples.json\` or external score signals.

Embedded examples use a fence of 32 backticks labeled \`example\`.
Between the input and expected output is a single line containing only \`.\`.
For invalid cases the expected side is the literal line \`ERROR\` (must reject).

`;

function pick(section, wantValid, n) {
  return examples
    .filter((e) => e.section === section && !!e.expect_error === !wantValid)
    .slice(0, n);
}

function emitExample(ex) {
  const expected = ex.expect_error ? "ERROR\n" : (ex.expected.endsWith("\n") ? ex.expected : `${ex.expected}\n`);
  const input = ex.input.endsWith("\n") ? ex.input : `${ex.input}\n`;
  return [
    `${fence} example`,
    input.replace(/\n$/, ""),
    ".",
    expected.replace(/\n$/, ""),
    fence,
    "",
  ].join("\n");
}

const blobs = [INTRO];
for (const section of sections) {
  const valids = pick(section, true, 5);
  const invalids = pick(section, false, 2);
  if (!valids.length && !invalids.length) continue;
  blobs.push(`## ${section}\n`);
  blobs.push(`Section **${section}** covers the corresponding TOML v1.0 constructs.\n`);
  if (valids.length) {
    blobs.push(`### Valid\n`);
    for (const ex of valids) blobs.push(emitExample(ex));
  }
  if (invalids.length) {
    blobs.push(`### Invalid (must reject)\n`);
    for (const ex of invalids) blobs.push(emitExample(ex));
  }
  blobs.push("");
}

const out = path.join(PACK, "spec", "spec.txt");
writeFileSync(out, blobs.join("\n"), "utf8");
console.log(`Wrote ${out} (${blobs.length} chunks)`);
