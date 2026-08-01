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

/**
 * Curated embedded-example ids per section (valid first, then invalid).
 * Built from run-swarm-sqlite-v1 failure classes so worker self-check / audit /
 * cross-section canary can see the counterintuitive behaviors. When a section
 * has no entry, fall back to a prefix slice of the oracle.
 */
const CURATED = {
  "Literals And Identifiers": {
    valid: [
      "literals-and-identifiers-001",
      "literals-and-identifiers-002",
      "literals-and-identifiers-023", // AS "from"
      "literals-and-identifiers-024", // AS "where"
      "literals-and-identifiers-026", // AS "order"
    ],
    invalid: ["literals-and-identifiers-090", "literals-and-identifiers-091"],
  },
  "Cast And Affinity": {
    valid: [
      "cast-and-affinity-001",
      "cast-and-affinity-006", // INTEGER affinity keeps '7.9'/'abc'
      "cast-and-affinity-013", // CAST('abc' AS INTEGER) → 0
      "cast-and-affinity-016", // typeof after INTEGER affinity
      "cast-and-affinity-017", // REAL affinity → typeof real
    ],
    invalid: ["cast-and-affinity-090", "cast-and-affinity-091"],
  },
  "Numeric Functions": {
    valid: [
      "numeric-functions-001",
      "numeric-functions-010", // min with NULL → NULL
      "numeric-functions-016", // typeof(0.0) = real
      "numeric-functions-033", // min(NULL, 1) → NULL
      "numeric-functions-034", // max(1, NULL) → NULL
    ],
    invalid: ["numeric-functions-090", "numeric-functions-091"],
  },
  Distinct: {
    valid: [
      "distinct-001",
      "distinct-002",
      "distinct-024", // DISTINCT + ORDER BY NULL first
      "distinct-003",
      "distinct-004",
    ],
    invalid: ["distinct-090", "distinct-091"],
  },
  "Order By And Limit": {
    valid: [
      "order-by-and-limit-001",
      "order-by-and-limit-002",
      "order-by-and-limit-003",
      "order-by-and-limit-004",
      "order-by-and-limit-005",
    ],
    invalid: ["order-by-and-limit-090", "order-by-and-limit-091"],
  },
};

function byId(id) {
  const ex = examples.find((e) => e.id === id);
  if (!ex) throw new Error(`CURATED id not found in examples.json: ${id}`);
  return ex;
}

function pick(section, wantValid, n) {
  const curated = CURATED[section];
  if (curated) {
    const ids = wantValid ? curated.valid : curated.invalid;
    return ids.slice(0, n).map(byId);
  }
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
