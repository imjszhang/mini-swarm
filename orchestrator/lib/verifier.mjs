/**
 * Orchestrator scoring facade.
 * Translates task-specific scorer fields (section/markdown) into generic
 * group/input vocabulary for mechanism modules.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { projectRoot } from "./config.mjs";
import { listTrackedFiles } from "./git.mjs";

const ROOT = projectRoot();
const EXAMPLES_PATH = path.join(ROOT, "spec", "examples.json");
const SPEC_TEXT_PATH = path.join(ROOT, "spec", "spec.txt");
const SCORE_SCRIPT = path.join(ROOT, "scorer", "score.mjs");

/**
 * @param {string} workspaceDir
 * @param {string} jsonOut
 * @param {{
 *   groups?: string[],
 *   itemIds?: string[],
 *   holdoutFile?: string|null,
 *   holdoutMode?: "include"|"exclude"|"only",
 *   examplesFile?: string|null,
 *   truncate?: number,
 *   maxFailures?: number,
 *   limit?: number|null,
 * }} [opts]
 */
export function scoreScope(workspaceDir, jsonOut, opts = {}) {
  const args = [
    SCORE_SCRIPT,
    "--workspace", workspaceDir,
    "--json", jsonOut,
  ];
  if (opts.examplesFile) {
    args.push("--examples", opts.examplesFile);
  }
  if (opts.groups?.length) {
    args.push("--sections", opts.groups.join(","));
  }
  if (opts.itemIds?.length) {
    args.push("--ids", opts.itemIds.join(","));
  }
  if (opts.holdoutFile && opts.holdoutMode && opts.holdoutMode !== "include") {
    args.push("--holdout-file", opts.holdoutFile, "--holdout-mode", opts.holdoutMode);
  }
  if (opts.truncate != null) {
    args.push("--truncate", String(opts.truncate));
  }
  if (opts.maxFailures != null) {
    args.push("--max-failures", String(opts.maxFailures));
  }
  if (opts.limit != null) {
    args.push("--limit", String(opts.limit));
  }

  const result = spawnSync(process.execPath, args, { encoding: "utf8" });

  let raw = null;
  try {
    raw = JSON.parse(readFileSync(jsonOut, "utf8"));
  } catch {
    raw = { rate: 0, passed: 0, total: 0, by_section: {}, failures: [], failure_count: 0, parse_error: true };
  }

  const failures = (raw.failures || []).map((f) => ({
    id: f.id,
    group: f.section,
    reason: f.reason,
    input: f.markdown,
    expected: f.expected,
    actual: f.actual,
  }));

  const byGroup = {};
  for (const [name, st] of Object.entries(raw.by_section || {})) {
    byGroup[name] = { ...st };
  }

  return {
    ok: result.status === 0,
    report: {
      scored_at: raw.scored_at,
      workspace: raw.workspace || workspaceDir,
      total: raw.total || 0,
      passed: raw.passed || 0,
      rate: raw.rate || 0,
      by_group: byGroup,
      // Compat: keep by_section alias for callers that still expect it.
      by_section: byGroup,
      failures,
      failure_count: raw.failure_count ?? failures.length,
      parse_error: !!raw.parse_error,
    },
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/**
 * Task-plugin hook: return normative reference text for a group name.
 * Opaque to mechanism modules (they treat it as a string blob).
 */
export function getReferenceText(group, maxChars = 8000) {
  if (!group || !existsSync(SPEC_TEXT_PATH)) return "";
  const text = readFileSync(SPEC_TEXT_PATH, "utf8");
  const heading = `## ${group}`;
  const start = text.indexOf(heading);
  if (start < 0) return "";
  const rest = text.slice(start + heading.length);
  const next = rest.search(/\n## /);
  const body = next >= 0 ? rest.slice(0, next) : rest;
  const out = `${heading}\n${body}`.trim();
  return out.length <= maxChars ? out : `${out.slice(0, maxChars)}…`;
}

/**
 * Scan tracked src files for long exact substrings of expected oracle output.
 * Detector only — does not fail the run by itself.
 */
export function scanForOracleLiterals(workspaceDir, examples, { minLineLen = 24 } = {}) {
  const files = listTrackedFiles(workspaceDir).filter((f) => {
    const n = f.replace(/\\/g, "/");
    return n.startsWith("src/") && /\.(ts|js|mjs)$/.test(n);
  });
  const contents = files.map((rel) => {
    try {
      return { rel, text: readFileSync(path.join(workspaceDir, rel), "utf8") };
    } catch {
      return null;
    }
  }).filter(Boolean);

  const hits = [];
  for (const ex of examples || []) {
    const expected = String(ex.html ?? ex.expected ?? "");
    for (const line of expected.split("\n")) {
      const needle = line.trim();
      if (needle.length < minLineLen) continue;
      for (const file of contents) {
        if (file.text.includes(needle)) {
          hits.push({
            id: ex.id,
            group: ex.section || ex.group,
            file: file.rel,
            snippet: needle.slice(0, 80),
          });
        }
      }
    }
  }
  return hits;
}

export function loadExamples() {
  if (!existsSync(EXAMPLES_PATH)) return [];
  return JSON.parse(readFileSync(EXAMPLES_PATH, "utf8"));
}

export function examplesPath() {
  return EXAMPLES_PATH;
}
