#!/usr/bin/env node
/**
 * Generate spec/examples.json + spec/sections.json from scripts/inputs/*.mjs
 * using Node built-in node:sqlite as the authoritative oracle.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.resolve(__dirname, "..");
const INPUTS_DIR = path.join(__dirname, "inputs");
const SPEC_DIR = path.join(PACK, "spec");
const OUT_EXAMPLES = path.join(SPEC_DIR, "examples.json");
const OUT_SECTIONS = path.join(SPEC_DIR, "sections.json");

export const SECTIONS = [
  "Literals And Identifiers",
  "Create Table",
  "Insert",
  "Select Core",
  "Where",
  "Order By And Limit",
  "Update",
  "Delete",
  "Arithmetic Operators",
  "Comparison And Logical Operators",
  "Between In Like",
  "Null Logic",
  "Case Expression",
  "Cast And Affinity",
  "String Functions",
  "Numeric Functions",
  "Aggregates No Group By",
  "Distinct",
  "Errors",
];

const SECTION_SET = new Set(SECTIONS);

function ensureSemicolon(sql) {
  const t = String(sql || "").trim();
  if (!t) return t;
  return t.endsWith(";") ? t : `${t};`;
}

function validateValue(v, caseId) {
  if (v === null) return;
  if (typeof v === "bigint") {
    throw new Error(`${caseId}: bigint value not allowed (need |n|<2^53)`);
  }
  if (v instanceof Uint8Array) {
    throw new Error(`${caseId}: BLOB (Uint8Array) out of scope`);
  }
  if (typeof v === "number" && !Number.isFinite(v)) {
    throw new Error(`${caseId}: non-finite number ${v}`);
  }
  if (typeof v !== "number" && typeof v !== "string") {
    throw new Error(`${caseId}: unexpected value type ${typeof v}`);
  }
}

function runValid(c) {
  const db = new DatabaseSync(":memory:");
  try {
    if (c.setup) db.exec(c.setup);
    const query = ensureSemicolon(c.query);
    const stmt = db.prepare(query);
    const cols = stmt.columns().map((col) => col.name);
    const seen = new Set();
    for (const name of cols) {
      if (seen.has(name)) {
        throw new Error(`${c.id}: duplicate column name "${name}" — add aliases`);
      }
      seen.add(name);
    }
    const objects = stmt.all();
    return objects.map((obj) => {
      const row = cols.map((name) => {
        const v = obj[name];
        validateValue(v, c.id);
        return v;
      });
      return row;
    });
  } finally {
    db.close();
  }
}

function runInvalid(c) {
  const db = new DatabaseSync(":memory:");
  let threw = false;
  try {
    db.exec(c.sql);
  } catch {
    threw = true;
  } finally {
    db.close();
  }
  if (!threw) {
    throw new Error(`${c.id}: expected SQLite to reject, but exec succeeded`);
  }
}

async function loadInputModules() {
  if (!existsSync(INPUTS_DIR)) {
    throw new Error(`Missing inputs dir: ${INPUTS_DIR}`);
  }
  const files = readdirSync(INPUTS_DIR)
    .filter((f) => f.endsWith(".mjs"))
    .sort();
  if (!files.length) throw new Error("No inputs/*.mjs files found");
  const mods = [];
  for (const f of files) {
    const full = path.join(INPUTS_DIR, f);
    const mod = await import(pathToFileURL(full).href);
    const data = mod.default;
    if (!data || !data.section || !Array.isArray(data.cases)) {
      throw new Error(`${f}: must export default { section, cases }`);
    }
    mods.push({ file: f, ...data });
  }
  return mods;
}

export async function generateOracle() {
  const mods = await loadInputModules();
  const examples = [];
  const seenIds = new Set();
  const seenSections = new Set();

  for (const mod of mods) {
    if (!SECTION_SET.has(mod.section)) {
      throw new Error(`${mod.file}: unknown section "${mod.section}"`);
    }
    seenSections.add(mod.section);
    for (const c of mod.cases) {
      if (!c.id || typeof c.id !== "string") {
        throw new Error(`${mod.file}: case missing id`);
      }
      if (seenIds.has(c.id)) {
        throw new Error(`duplicate id: ${c.id}`);
      }
      seenIds.add(c.id);

      if (c.invalid) {
        if (!c.sql) throw new Error(`${c.id}: invalid case needs sql`);
        runInvalid(c);
        const normalized = c.sql.endsWith("\n") ? c.sql : `${ensureSemicolon(c.sql)}\n`;
        examples.push({
          id: c.id,
          section: mod.section,
          input: normalized,
          expected: "",
          expect_error: true,
          markdown: normalized,
          html: "",
        });
      } else {
        if (!c.query) throw new Error(`${c.id}: valid case needs query`);
        const rows = runValid(c);
        const query = ensureSemicolon(c.query);
        const setup = c.setup ? (c.setup.endsWith("\n") ? c.setup : `${c.setup}\n`) : "";
        const input = `${setup}${query}\n`;
        const expected = JSON.stringify(rows);
        examples.push({
          id: c.id,
          section: mod.section,
          input,
          expected,
          expect_error: false,
          markdown: input,
          html: expected,
        });
      }
    }
  }

  mkdirSync(SPEC_DIR, { recursive: true });
  const sectionsOut = SECTIONS.filter((s) => seenSections.has(s));
  writeFileSync(OUT_EXAMPLES, `${JSON.stringify(examples, null, 1)}\n`, "utf8");
  writeFileSync(OUT_SECTIONS, `${JSON.stringify(sectionsOut, null, 1)}\n`, "utf8");
  return { examples, sectionsOut, OUT_EXAMPLES, OUT_SECTIONS };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  generateOracle()
    .then(({ examples, sectionsOut, OUT_EXAMPLES: ex, OUT_SECTIONS: sec }) => {
      console.log(`Wrote ${examples.length} examples → ${ex}`);
      console.log(`Wrote ${sectionsOut.length} sections → ${sec}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
