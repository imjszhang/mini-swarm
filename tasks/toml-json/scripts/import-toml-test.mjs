#!/usr/bin/env node
/**
 * Convert vendor/toml-test (TOML 1.0 file list) into examples.json + sections.json.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.resolve(__dirname, "..");
const VENDOR_TESTS = path.join(PACK, "vendor", "toml-test", "tests");
const FILE_LIST = path.join(VENDOR_TESTS, "files-toml-1.0.0");
const OUT_EXAMPLES = path.join(PACK, "spec", "examples.json");
const OUT_SECTIONS = path.join(PACK, "spec", "sections.json");

const SECTION_MAP = {
  array: "Arrays",
  bool: "Booleans",
  comment: "Comments",
  datetime: "Offset Date-Time",
  float: "Floats",
  "inline-table": "Inline Tables",
  integer: "Integers",
  key: "Keys",
  spec: "Spec Examples",
  string: "Strings",
  table: "Tables",
  "array-of-tables": "Array of Tables",
};

function sectionFromRel(rel) {
  // valid/integer/foo.toml or invalid/string/bad.toml
  const parts = rel.replace(/\\/g, "/").split("/");
  if (parts.length < 3) {
    if (parts[0] === "valid" || parts[0] === "invalid") return "Root";
    return "Other";
  }
  const kind = parts[1];
  if (kind === "table" && parts[2] === "array") return "Array of Tables";
  return SECTION_MAP[kind] || kind.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function stableJson(text) {
  return `${JSON.stringify(JSON.parse(text))}\n`;
}

function idFromRel(rel) {
  return rel
    .replace(/\\/g, "/")
    .replace(/\.toml$/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function main() {
  if (!existsSync(FILE_LIST)) {
    console.error(`Missing ${FILE_LIST}. Vendor toml-test first.`);
    process.exit(1);
  }
  const lines = readFileSync(FILE_LIST, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && l.endsWith(".toml"));

  const examples = [];
  const sectionSet = new Set();
  let skipped = 0;

  for (const rel of lines) {
    const tomlPath = path.join(VENDOR_TESTS, rel);
    if (!existsSync(tomlPath)) {
      skipped += 1;
      continue;
    }
    const isInvalid = rel.startsWith("invalid/");
    const section = sectionFromRel(rel);
    sectionSet.add(section);
    const input = readFileSync(tomlPath, "utf8");
    let expected = "";
    if (!isInvalid) {
      const jsonPath = tomlPath.replace(/\.toml$/i, ".json");
      if (!existsSync(jsonPath)) {
        skipped += 1;
        continue;
      }
      expected = stableJson(readFileSync(jsonPath, "utf8"));
    }
    examples.push({
      id: idFromRel(rel),
      section,
      input,
      expected,
      expect_error: isInvalid,
      // Compat aliases for older scorer paths / oracle scan
      markdown: input,
      html: expected,
    });
  }

  // Prefer a stable section order for TOC
  const preferred = [
    "Comments",
    "Keys",
    "Strings",
    "Integers",
    "Floats",
    "Booleans",
    "Offset Date-Time",
    "Arrays",
    "Tables",
    "Inline Tables",
    "Array of Tables",
    "Spec Examples",
    "Root",
    "Other",
  ];
  const sections = [
    ...preferred.filter((s) => sectionSet.has(s)),
    ...[...sectionSet].filter((s) => !preferred.includes(s)).sort(),
  ];

  mkdirSync(path.dirname(OUT_EXAMPLES), { recursive: true });
  writeFileSync(OUT_EXAMPLES, `${JSON.stringify(examples, null, 2)}\n`, "utf8");
  writeFileSync(OUT_SECTIONS, `${JSON.stringify(sections, null, 2)}\n`, "utf8");

  const valid = examples.filter((e) => !e.expect_error).length;
  const invalid = examples.filter((e) => e.expect_error).length;
  console.log(`Wrote ${examples.length} examples → ${OUT_EXAMPLES}`);
  console.log(`  valid=${valid} invalid=${invalid} skipped=${skipped}`);
  console.log(`Sections (${sections.length}): ${sections.join(", ")}`);
  console.log(`Wrote sections → ${OUT_SECTIONS}`);
}

main();
