/**
 * Parallel task packs for swarm (commonmark default, toml-json, …).
 * Resolves spec / prompts / skeleton / canary without replacing the CommonMark tree.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./config.mjs";

const ROOT = projectRoot();

const COMMONMARK_SECTIONS = [
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

/** @type {Map<string, object>} */
const cache = new Map();

export function listTaskPackIds() {
  return ["commonmark", "toml-json", "sqlite-micro"];
}

/**
 * @param {string} [name]
 */
export function resolveTaskPack(name = "commonmark") {
  const id = String(name || "commonmark").trim() || "commonmark";
  if (cache.has(id)) return cache.get(id);

  let pack;
  if (id === "commonmark") {
    pack = {
      id: "commonmark",
      root: ROOT,
      specDir: path.join(ROOT, "spec"),
      examplesPath: path.join(ROOT, "spec", "examples.json"),
      specTextPath: path.join(ROOT, "spec", "spec.txt"),
      sectionsPath: null,
      promptsDir: path.join(ROOT, "prompts"),
      skeleton: "commonmark",
      canaryInput: "canary\n",
      canaryRequireExit0: true,
      goalLabel: "CommonMark Markdown → HTML",
      swarmOverrides: {},
    };
  } else if (id === "toml-json") {
    const root = path.join(ROOT, "tasks", "toml-json");
    pack = {
      id: "toml-json",
      root,
      specDir: path.join(root, "spec"),
      examplesPath: path.join(root, "spec", "examples.json"),
      specTextPath: path.join(root, "spec", "spec.txt"),
      sectionsPath: path.join(root, "spec", "sections.json"),
      promptsDir: path.join(root, "prompts"),
      skeleton: "toml-json",
      canaryInput: "a = 1\n",
      canaryRequireExit0: true,
      goalLabel: "TOML v1.0 → toml-test tagged JSON",
      swarmOverrides: {},
    };
  } else if (id === "sqlite-micro") {
    const root = path.join(ROOT, "tasks", "sqlite-micro");
    pack = {
      id: "sqlite-micro",
      root,
      specDir: path.join(root, "spec"),
      examplesPath: path.join(root, "spec", "examples.json"),
      specTextPath: path.join(root, "spec", "spec.txt"),
      sectionsPath: path.join(root, "spec", "sections.json"),
      promptsDir: path.join(root, "prompts"),
      skeleton: "sqlite-micro",
      canaryInput: "SELECT 1;\n",
      canaryRequireExit0: true,
      goalLabel: "micro-SQL (SQLite subset) → row-array JSON",
      swarmOverrides: {},
    };
  } else {
    throw new Error(`Unknown task pack: ${id}. Known: ${listTaskPackIds().join(", ")}`);
  }

  if (!existsSync(pack.examplesPath)) {
    throw new Error(`Task pack ${id}: missing examples at ${pack.examplesPath}`);
  }
  if (!existsSync(pack.specTextPath)) {
    throw new Error(`Task pack ${id}: missing spec at ${pack.specTextPath}`);
  }

  cache.set(id, pack);
  return pack;
}

export function loadPackSections(pack) {
  if (pack.sectionsPath && existsSync(pack.sectionsPath)) {
    return JSON.parse(readFileSync(pack.sectionsPath, "utf8"));
  }
  if (pack.id === "commonmark") return COMMONMARK_SECTIONS.slice();
  return [];
}

/** Active pack for this process (set by swarm.mjs). */
let activePack = null;

export function setActiveTaskPack(packOrName) {
  activePack = typeof packOrName === "string" ? resolveTaskPack(packOrName) : packOrName;
  return activePack;
}

export function getActiveTaskPack() {
  return activePack || resolveTaskPack("commonmark");
}
