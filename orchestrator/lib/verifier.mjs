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
import { getActiveTaskPack } from "./task-pack.mjs";

const ROOT = projectRoot();
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
  const pack = getActiveTaskPack();
  const args = [
    SCORE_SCRIPT,
    "--workspace", workspaceDir,
    "--json", jsonOut,
    "--examples", opts.examplesFile || pack.examplesPath,
  ];
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

  const result = spawnSync(process.execPath, args, { encoding: "utf8", windowsHide: true });

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
    input: f.input ?? f.markdown,
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
 */
export function getReferenceText(group, maxChars = 8000) {
  const pack = getActiveTaskPack();
  if (!group || !existsSync(pack.specTextPath)) return "";
  const text = readFileSync(pack.specTextPath, "utf8");
  const heading = `## ${group}`;
  const lines = text.split(/\r?\n/);
  const fence = "`".repeat(32);
  let startIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] === heading || lines[i].startsWith(`${heading} `)) {
      startIdx = i;
      break;
    }
  }
  if (startIdx < 0) return "";

  let inFence = false;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith(fence)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^## /.test(line)) {
      endIdx = i;
      break;
    }
  }

  const out = lines.slice(startIdx, endIdx).join("\n").trim();
  return out.length <= maxChars ? out : `${out.slice(0, maxChars)}…`;
}

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
    if (ex.expect_error) continue;
    const expected = String(ex.expected ?? ex.html ?? "");
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
  const pack = getActiveTaskPack();
  if (!existsSync(pack.examplesPath)) return [];
  return JSON.parse(readFileSync(pack.examplesPath, "utf8"));
}

export function examplesPath() {
  return getActiveTaskPack().examplesPath;
}
