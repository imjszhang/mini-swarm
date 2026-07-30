/**
 * Harness self-check against examples embedded in normative spec text.
 * Never reads examples.json (hidden grader).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
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
  if (normalizeTextOutput(actual) === normalizeTextOutput(expected)) {
    return { ok: true };
  }
  return { ok: false, detail: "HTML/text mismatch" };
}

/**
 * Collect embedded examples from assigned spec sections (reference text only).
 */
export function collectSectionExamples(sections, {
  getText = getReferenceText,
  maxChars = 64000,
  maxExamples = 5,
} = {}) {
  const all = [];
  for (const section of sections || []) {
    const text = getText(section, maxChars);
    all.push(...parseEmbeddedExamples(text));
    if (all.length >= maxExamples) break;
  }
  return all.slice(0, Math.max(0, maxExamples));
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
 * Run up to maxExamples embedded checks in a workspace.
 * @returns {{ ok: boolean, checked: number, kind?: string, stderr?: string, failures?: object[] }}
 */
export function runEmbeddedSelfCheck({
  workspaceDir,
  sections,
  maxExamples = 5,
  pack = null,
  getText = getReferenceText,
  maxChars = 64000,
}) {
  const p = pack || getActiveTaskPack();
  const examples = collectSectionExamples(sections, {
    getText,
    maxChars,
    maxExamples,
  });
  if (!examples.length) {
    return { ok: true, checked: 0, skipped: true };
  }

  const failures = [];
  for (let idx = 0; idx < examples.length; idx += 1) {
    const ex = examples[idx];
    const run = runCliOnce(workspaceDir, ex.input);
    if (run.error) {
      failures.push({ index: idx, reason: run.stderr || "cli spawn error" });
      break;
    }
    if (ex.expectError) {
      if (run.status === 0) {
        failures.push({
          index: idx,
          reason: "expected non-zero exit (ERROR example accepted)",
          stdout: run.stdout.slice(0, 200),
        });
      }
      continue;
    }
    if (run.status !== 0) {
      failures.push({
        index: idx,
        reason: `expected exit 0, got ${run.status}`,
        stderr: run.stderr.slice(0, 300),
      });
      continue;
    }
    const cmp = compareCliOutput(run.stdout, ex.expected, p.id);
    if (!cmp.ok) {
      failures.push({
        index: idx,
        reason: cmp.detail || "output mismatch",
        stdout: run.stdout.slice(0, 200),
      });
    }
  }

  if (!failures.length) {
    return { ok: true, checked: examples.length };
  }

  const first = failures[0];
  const stderr = [
    `${failures.length}/${examples.length} embedded example(s) failed`,
    `first[#${first.index}]: ${first.reason}`,
    first.stderr || first.stdout || "",
  ].filter(Boolean).join("\n");

  return {
    ok: false,
    kind: "embedded",
    checked: examples.length,
    stderr,
    failures,
  };
}
