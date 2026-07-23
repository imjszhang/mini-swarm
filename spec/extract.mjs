#!/usr/bin/env node
/**
 * Parse CommonMark spec.txt → spec/examples.json (core subset).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = path.join(__dirname, "spec.txt");
const OUT_PATH = path.join(__dirname, "examples.json");

/** Sections excluded from scoring (too hard / out of core scope). */
const EXCLUDED_SECTIONS = new Set([
  "HTML blocks",
  "Raw HTML",
  "Link reference definitions",
  "Autolinks",
  "Entity and numeric character references",
]);

const FENCE = "`".repeat(32);
const EXAMPLE_OPEN = `${FENCE} example`;

function parseSpec(text) {
  const lines = text.split(/\r?\n/);
  let section = "Introduction";
  const examples = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      section = heading[1].trim();
      i += 1;
      continue;
    }

    if (line === EXAMPLE_OPEN) {
      i += 1;
      const mdLines = [];
      while (i < lines.length && lines[i] !== ".") {
        mdLines.push(lines[i]);
        i += 1;
      }
      if (i >= lines.length || lines[i] !== ".") {
        throw new Error(`Malformed example in section ${section} at line ${i + 1}`);
      }
      i += 1; // skip '.'
      const htmlLines = [];
      while (i < lines.length && lines[i] !== FENCE) {
        htmlLines.push(lines[i]);
        i += 1;
      }
      if (i >= lines.length) {
        throw new Error(`Unclosed example in section ${section}`);
      }
      i += 1; // skip closing fence

      if (!EXCLUDED_SECTIONS.has(section)) {
        examples.push({
          id: `ex-${String(examples.length + 1).padStart(4, "0")}`,
          section,
          markdown: mdLines.join("\n"),
          html: htmlLines.join("\n"),
        });
      }
      continue;
    }

    i += 1;
  }

  return examples;
}

const specText = readFileSync(SPEC_PATH, "utf8");
const examples = parseSpec(specText);
writeFileSync(OUT_PATH, `${JSON.stringify(examples, null, 2)}\n`, "utf8");

const bySection = {};
for (const ex of examples) {
  bySection[ex.section] = (bySection[ex.section] || 0) + 1;
}

console.log(`Extracted ${examples.length} examples → ${OUT_PATH}`);
console.log("Sections:", bySection);
