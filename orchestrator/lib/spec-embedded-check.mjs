/**
 * Harness self-check against examples embedded in normative spec text.
 * Never reads examples.json (hidden grader).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { listSpecSections } from "./spec-toc.mjs";
import { getActiveTaskPack } from "./task-pack.mjs";
import { getReferenceText } from "./verifier.mjs";

const FENCE = "`".repeat(32);

/**
 * Parse CommonMark-style / toml-json embedded example fences from spec excerpt.
 * @returns {{ input: string, expected: string, expectError: boolean }[]}
 */
export function parseEmbeddedExamples(text) {
  const src = String(text || "");
  const examples = [];
  let i = 0;
  const open = `${FENCE} example`;
  while (i < src.length) {
    const start = src.indexOf(open, i);
    if (start < 0) break;
    let bodyStart = start + open.length;
    if (src[bodyStart] === "\r") bodyStart += 1;
    if (src[bodyStart] === "\n") bodyStart += 1;
    const close = src.indexOf(FENCE, bodyStart);
    if (close < 0) break;
    const body = src.slice(bodyStart, close);
    i = close + FENCE.length;

    const lines = body.split(/\r?\n/);
    // Drop trailing empty line before closing fence if present
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    const dotIdx = lines.findIndex((l) => l === ".");
    if (dotIdx < 0) continue;
    const input = lines.slice(0, dotIdx).join("\n");
    const expected = lines.slice(dotIdx + 1).join("\n");
    const expectError = expected.trim() === "ERROR";
    examples.push({ input, expected, expectError });
  }
  return examples;
}

/** Recursively sort object keys for order-insensitive JSON compare. */
export function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = canonicalizeJson(value[k]);
    }
    return out;
  }
  return value;
}

export function deepEqualJson(a, b) {
  return JSON.stringify(canonicalizeJson(a)) === JSON.stringify(canonicalizeJson(b));
}

/**
 * Deep equality with relative numeric tolerance.
 * Numbers: |a-b| <= 1e-9 * max(1, |a|, |b|). Arrays element-wise; objects by key set.
 */
export function deepEqualJsonNumeric(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a === "number" && typeof b === "number") {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    const tol = 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
    return Math.abs(a - b) <= tol;
  }
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqualJsonNumeric(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object") {
    const ak = Object.keys(a).sort();
    const bk = Object.keys(b).sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i += 1) {
      if (ak[i] !== bk[i]) return false;
      if (!deepEqualJsonNumeric(a[ak[i]], b[bk[i]])) return false;
    }
    return true;
  }
  return false;
}

export function normalizeTextOutput(s) {
  return String(s ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n+$/, "");
}

/**
 * Compare CLI stdout to expected (pack-aware).
 * @returns {{ ok: boolean, detail?: string }}
 */
export function compareCliOutput(actual, expected, packId = "commonmark") {
  if (packId === "toml-json") {
    try {
      const a = JSON.parse(String(actual || ""));
      const e = JSON.parse(String(expected || ""));
      if (deepEqualJson(a, e)) return { ok: true };
      return { ok: false, detail: "JSON mismatch (key-order insensitive)" };
    } catch (err) {
      return { ok: false, detail: `JSON parse: ${err.message || err}` };
    }
  }
  if (packId === "sqlite-micro") {
    try {
      const a = JSON.parse(String(actual || ""));
      const e = JSON.parse(String(expected || ""));
      if (deepEqualJsonNumeric(a, e)) return { ok: true };
      return { ok: false, detail: "JSON mismatch (numeric-tolerant)" };
    } catch (err) {
      return { ok: false, detail: `JSON parse: ${err.message || err}` };
    }
  }
  if (normalizeTextOutput(actual) === normalizeTextOutput(expected)) {
    return { ok: true };
  }
  return { ok: false, detail: "HTML/text mismatch" };
}

/** Mulberry32 PRNG — deterministic from seed string/number. */
export function seededRng(seed) {
  let h = 0;
  const s = String(seed ?? "0");
  for (let i = 0; i < s.length; i += 1) {
    h = Math.imul(h ^ s.charCodeAt(i), 2654435761);
  }
  let t = (h >>> 0) || 1;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sample up to k items without replacement (Fisher–Yates partial shuffle).
 * When seed is null/undefined, take the first k items (legacy order).
 */
export function sampleExamples(items, k, seed = null) {
  const list = Array.isArray(items) ? [...items] : [];
  const n = Math.max(0, Math.min(Number(k) || 0, list.length));
  if (!n) return [];
  if (seed == null) return list.slice(0, n);
  const rand = seededRng(seed);
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, n);
}

/**
 * Collect embedded examples from assigned spec sections (reference text only).
 * With `seed`, sample randomly among all collected examples instead of prefix.
 */
export function collectSectionExamples(sections, {
  getText = getReferenceText,
  maxChars = 64000,
  maxExamples = 5,
  seed = null,
} = {}) {
  const all = [];
  for (const section of sections || []) {
    const text = getText(section, maxChars);
    all.push(...parseEmbeddedExamples(text));
  }
  return sampleExamples(all, maxExamples, seed);
}

/**
 * Sample embedded examples from sections outside excludeSections.
 */
export function collectCrossSectionExamples(excludeSections, {
  getText = getReferenceText,
  maxChars = 64000,
  maxExamples = 5,
  seed = null,
  allSections = null,
} = {}) {
  const exclude = new Set(excludeSections || []);
  const sections = (allSections || listSpecSections()).filter((s) => !exclude.has(s));
  const all = [];
  for (const section of sections) {
    const text = getText(section, maxChars);
    for (const ex of parseEmbeddedExamples(text)) {
      all.push({ ...ex, section });
    }
  }
  return sampleExamples(all, maxExamples, seed);
}

function runCliOnce(workspaceDir, input) {
  const cli = path.join(workspaceDir, "dist", "cli.js");
  if (!existsSync(cli)) {
    return { status: null, stdout: "", stderr: `Missing ${cli}`, error: true };
  }
  const result = spawnSync(process.execPath, [cli], {
    cwd: workspaceDir,
    input: input.endsWith("\n") ? input : `${input}\n`,
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    error: !!result.error,
  };
}

/**
 * Run a list of embedded examples against workspace CLI.
 * @returns {{ ok: boolean, checked: number, kind?: string, stderr?: string, failures?: object[], skipped?: boolean }}
 */
export function runExamples(workspaceDir, examples, pack = null) {
  const p = pack || getActiveTaskPack();
  const list = Array.isArray(examples) ? examples : [];
  if (!list.length) {
    return { ok: true, checked: 0, skipped: true };
  }

  const failures = [];
  for (let idx = 0; idx < list.length; idx += 1) {
    const ex = list[idx];
    const run = runCliOnce(workspaceDir, ex.input);
    if (run.error) {
      failures.push({ index: idx, reason: run.stderr || "cli spawn error", section: ex.section });
      break;
    }
    if (ex.expectError) {
      if (run.status === 0) {
        failures.push({
          index: idx,
          reason: "expected non-zero exit (ERROR example accepted)",
          stdout: run.stdout.slice(0, 200),
          section: ex.section,
        });
      }
      continue;
    }
    if (run.status !== 0) {
      failures.push({
        index: idx,
        reason: `expected exit 0, got ${run.status}`,
        stderr: run.stderr.slice(0, 300),
        section: ex.section,
      });
      continue;
    }
    const cmp = compareCliOutput(run.stdout, ex.expected, p.id);
    if (!cmp.ok) {
      failures.push({
        index: idx,
        reason: cmp.detail || "output mismatch",
        stdout: run.stdout.slice(0, 200),
        section: ex.section,
      });
    }
  }

  if (!failures.length) {
    return { ok: true, checked: list.length };
  }

  const first = failures[0];
  const stderr = [
    `${failures.length}/${list.length} embedded example(s) failed`,
    first.section ? `section=${first.section}` : null,
    `first[#${first.index}]: ${first.reason}`,
    first.stderr || first.stdout || "",
  ].filter(Boolean).join("\n");

  return {
    ok: false,
    kind: "embedded",
    checked: list.length,
    stderr,
    failures,
  };
}

/**
 * Run up to maxExamples embedded checks in a workspace (assigned sections).
 * @returns {{ ok: boolean, checked: number, kind?: string, stderr?: string, failures?: object[] }}
 */
export function runEmbeddedSelfCheck({
  workspaceDir,
  sections,
  maxExamples = 5,
  pack = null,
  getText = getReferenceText,
  maxChars = 64000,
  seed = null,
}) {
  const examples = collectSectionExamples(sections, {
    getText,
    maxChars,
    maxExamples,
    seed,
  });
  return runExamples(workspaceDir, examples, pack);
}

/**
 * Cross-section regression canary (sections outside the leaf scope).
 */
export function runCrossSectionSelfCheck({
  workspaceDir,
  excludeSections,
  maxExamples = 5,
  pack = null,
  getText = getReferenceText,
  maxChars = 64000,
  seed = null,
  allSections = null,
}) {
  if (!maxExamples || maxExamples <= 0) {
    return { ok: true, checked: 0, skipped: true };
  }
  const examples = collectCrossSectionExamples(excludeSections, {
    getText,
    maxChars,
    maxExamples,
    seed,
    allSections,
  });
  const result = runExamples(workspaceDir, examples, pack);
  if (!result.ok) result.kind = "embedded-cross";
  return result;
}
