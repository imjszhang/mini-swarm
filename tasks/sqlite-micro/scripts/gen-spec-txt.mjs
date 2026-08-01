#!/usr/bin/env node
/**
 * Build normative spec.txt from spec-prose/*.md + embedded examples from examples.json.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SECTIONS } from "./gen-oracle.mjs";

const PACK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROSE_DIR = path.join(PACK, "spec-prose");
const examples = JSON.parse(readFileSync(path.join(PACK, "spec", "examples.json"), "utf8"));
const sections = JSON.parse(readFileSync(path.join(PACK, "spec", "sections.json"), "utf8"));
const fence = "`".repeat(32);

const INTRO = `# micro-SQL (SQLite subset) — experiment pack

This document is the normative reference for the mini-swarm **sqlite-micro** task.
Implement an in-memory SQL engine in TypeScript that:

- Accepts a SQL script on stdin (statements end with \`;\`).
- Executes all statements in order.
- On success: exit 0 and print the result of the **last SELECT** as a JSON
  two-dimensional array (rows of column values) on a single line of stdout.
  If the script has no SELECT, print \`[]\`.
- On any error: write a message to stderr and exit non-zero.

Value mapping: INTEGER/REAL → JSON number, TEXT → string, NULL → null.

Do not consult \`examples.json\` or external score signals.

Embedded examples use a fence of 32 backticks labeled \`example\`.
Between the input and expected output is a single line containing only \`.\`.
For invalid cases the expected side is the literal line \`ERROR\` (must reject).

Out of scope for this experiment: JOIN, GROUP BY/HAVING, subqueries, views,
indexes, transactions, PRAGMA/ATTACH, BLOB, datetime functions, window
functions, collation, and column constraints (PK/UNIQUE/NOT NULL/DEFAULT/AUTOINCREMENT).

`;

const SECTION_TO_PROSE = {
  "Literals And Identifiers": "01-literals-and-identifiers.md",
  "Create Table": "02-create-table.md",
  Insert: "03-insert.md",
  "Select Core": "04-select-core.md",
  Where: "05-where.md",
  "Order By And Limit": "06-order-by-and-limit.md",
  Update: "07-update.md",
  Delete: "08-delete.md",
  "Arithmetic Operators": "09-arithmetic-operators.md",
  "Comparison And Logical Operators": "10-comparison-and-logical-operators.md",
  "Between In Like": "11-between-in-like.md",
  "Null Logic": "12-null-logic.md",
  "Case Expression": "13-case-expression.md",
  "Cast And Affinity": "14-cast-and-affinity.md",
  "String Functions": "15-string-functions.md",
  "Numeric Functions": "16-numeric-functions.md",
  "Aggregates No Group By": "17-aggregates-no-group-by.md",
  Distinct: "18-distinct.md",
  Errors: "19-errors.md",
};

function pick(section, wantValid, n) {
  return examples
    .filter((e) => e.section === section && !!e.expect_error === !wantValid)
    .slice(0, n);
}

function emitExample(ex) {
  const expected = ex.expect_error
    ? "ERROR\n"
    : ex.expected.endsWith("\n")
      ? ex.expected
      : `${ex.expected}\n`;
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

function loadProse(section) {
  const name = SECTION_TO_PROSE[section];
  if (!name) throw new Error(`No prose mapping for section: ${section}`);
  const p = path.join(PROSE_DIR, name);
  if (!existsSync(p)) throw new Error(`Missing prose: ${p}`);
  return readFileSync(p, "utf8").trim();
}

const blobs = [INTRO];
for (const section of sections) {
  if (!SECTIONS.includes(section)) {
    throw new Error(`Unexpected section in sections.json: ${section}`);
  }
  const prose = loadProse(section);
  blobs.push(`## ${section}\n`);
  blobs.push(`${prose}\n`);
  const valids = pick(section, true, 5);
  const invalids = pick(section, false, 2);
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

const outText = blobs.join("\n");
if (outText.length >= 64000) {
  console.error(`spec.txt too large: ${outText.length} chars (limit 64000). Trim prose.`);
  process.exit(1);
}

const out = path.join(PACK, "spec", "spec.txt");
writeFileSync(out, outText, "utf8");
console.log(`Wrote ${out} (${outText.length} chars, ${sections.length} sections)`);

// Sanity: every prose file exists
const proseFiles = readdirSync(PROSE_DIR).filter((f) => f.endsWith(".md"));
if (proseFiles.length < 19) {
  console.warn(`Warning: only ${proseFiles.length} prose files found`);
}
