/**
 * Multi-perspective review stack (S-A-008): low-correlation views.
 * Findings feed the planner — never expose scores.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { getDiff, listTrackedFiles, readDesign } from "./git.mjs";
import { extractJsonObject } from "./json-parse.mjs";
import {
  buildReviewCodebasePrompt,
  buildReviewDiffPrompt,
  buildReviewSpecPrompt,
} from "./prompts.mjs";
import { formatSpecToc } from "./spec-toc.mjs";
import { agentUsage, spawnAgent } from "../runner.mjs";

/**
 * Resolve the git ref used as the left side of review-diff.
 * Prefer the SHA captured at the previous review (or run start) so the
 * window spans all merges since then — not just HEAD~1 (often a guide note).
 * @param {string|null|undefined} sinceSha
 * @returns {string}
 */
export function resolveReviewDiffRef(sinceSha) {
  const s = String(sinceSha || "").trim();
  if (/^[0-9a-f]{7,40}$/i.test(s)) return s;
  return "HEAD~1";
}

function walkListing(dir, rel = "src", out = [], depth = 0) {
  const abs = path.join(dir, rel);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const childRel = path.join(rel, name).replace(/\\/g, "/");
    const st = statSync(path.join(dir, childRel));
    if (st.isDirectory()) {
      out.push(`${"  ".repeat(depth)}${name}/`);
      if (depth < 3) walkListing(dir, childRel, out, depth + 1);
    } else {
      out.push(`${"  ".repeat(depth)}${name} (${st.size}b)`);
    }
  }
  return out;
}

function fileExcerpts(workspaceDir, maxFiles = 6, maxChars = 1200) {
  const files = listTrackedFiles(workspaceDir)
    .filter((f) => f.replace(/\\/g, "/").startsWith("src/") && /\.ts$/.test(f))
    .slice(0, maxFiles);
  const parts = [];
  for (const rel of files) {
    try {
      const text = readFileSync(path.join(workspaceDir, rel), "utf8");
      parts.push(`### ${rel}\n\`\`\`\n${text.slice(0, maxChars)}\n\`\`\``);
    } catch { /* skip */ }
  }
  return parts.join("\n\n") || "_None._";
}

async function runOne({ role, prompt, cwd, config, runDir, metrics, logKey }) {
  const result = await spawnAgent({
    role,
    prompt,
    cwd,
    config,
    runDir,
    logKey,
    timeoutMs: Math.min((config.taskTimeoutMinutes || 20) * 60 * 1000, 8 * 60 * 1000),
  });
  metrics.recordAgentCall({
    role,
    ok: result.ok,
    ...agentUsage(result),
  });
  const parsed = extractJsonObject(result.output || "");
  return {
    role,
    ok: result.ok,
    findings: parsed?.findings || [],
    perspective: parsed?.perspective || role,
    raw_ok: !!parsed,
  };
}

/**
 * Run up to N perspectives (diff / codebase / spec). Mixed model tiers via role map.
 * @param {string|null} [sinceSha] Left side of review-diff (previous review tip SHA).
 */
export async function runReviewStack({
  workspaceDir,
  config,
  runDir,
  metrics,
  perspectives = 3,
  sinceSha = null,
}) {
  const jobs = [];
  if (perspectives >= 1) {
    const diffRef = resolveReviewDiffRef(sinceSha);
    jobs.push(runOne({
      role: "review-diff",
      prompt: buildReviewDiffPrompt({ diff: getDiff(workspaceDir, diffRef) }),
      cwd: workspaceDir,
      config,
      runDir,
      metrics,
      logKey: `review-diff-${Date.now()}`,
    }));
  }
  if (perspectives >= 2) {
    jobs.push(runOne({
      role: "review-codebase",
      prompt: buildReviewCodebasePrompt({
        treeListing: walkListing(workspaceDir).join("\n"),
        fileExcerpts: fileExcerpts(workspaceDir),
      }),
      cwd: workspaceDir,
      config,
      runDir,
      metrics,
      logKey: `review-codebase-${Date.now()}`,
    }));
  }
  if (perspectives >= 3) {
    let contracts = "";
    const cp = path.join(workspaceDir, "src", "contracts.ts");
    if (existsSync(cp)) contracts = readFileSync(cp, "utf8").slice(0, 4000);
    jobs.push(runOne({
      role: "review-spec",
      prompt: buildReviewSpecPrompt({
        designMd: readDesign(workspaceDir),
        specToc: formatSpecToc(),
        contracts,
      }),
      cwd: workspaceDir,
      config,
      runDir,
      metrics,
      logKey: `review-spec-${Date.now()}`,
    }));
  }

  const results = await Promise.all(jobs);
  const findings = [];
  for (const r of results) {
    for (const f of r.findings) {
      findings.push({ ...f, perspective: r.perspective });
    }
  }
  return { results, findings };
}

export function formatFindingsForPlanner(findings, max = 20) {
  const items = (findings || []).slice(-max);
  if (!items.length) return "_None yet._";
  return items.map((f, i) => (
    `${i + 1}. [${f.severity || "?"}/${f.perspective || "?"}] ${f.summary || ""}`
      + (f.files?.length ? ` (${f.files.join(", ")})` : "")
  )).join("\n");
}
