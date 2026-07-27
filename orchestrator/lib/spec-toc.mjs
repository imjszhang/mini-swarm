/**
 * Spec table of contents from spec.txt — never from examples.json
 * (examples would leak the existence of a scoring suite).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./config.mjs";

const KNOWN_SECTIONS = [
  "Tabs",
  "Backslash escapes",
  "Entity and numeric character references",
  "Precedence",
  "Thematic breaks",
  "ATX headings",
  "Setext headings",
  "Indented code blocks",
  "Fenced code blocks",
  "HTML blocks",
  "Link reference definitions",
  "Paragraphs",
  "Blank lines",
  "Block quotes",
  "List items",
  "Lists",
  "Code spans",
  "Emphasis and strong emphasis",
  "Links",
  "Images",
  "Autolinks",
  "Raw HTML",
  "Hard line breaks",
  "Soft line breaks",
  "Textual content",
];

export function listSpecSections() {
  const specPath = path.join(projectRoot(), "spec", "spec.txt");
  if (!existsSync(specPath)) return KNOWN_SECTIONS.slice();
  const text = readFileSync(specPath, "utf8");
  const found = [];
  for (const name of KNOWN_SECTIONS) {
    if (text.includes(`## ${name}`)) found.push(name);
  }
  return found.length ? found : KNOWN_SECTIONS.slice();
}

export function formatSpecToc() {
  return listSpecSections().map((s) => `- ${s}`).join("\n");
}
