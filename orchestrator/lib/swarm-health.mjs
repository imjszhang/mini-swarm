/**
 * Engineering health checks for swarm (build + CLI canary).
 * Hidden grader: never reads examples.json or suite scores.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { npmExec } from "./win-exec.mjs";
import { getActiveTaskPack } from "./task-pack.mjs";

export function ensureBuilt(workspaceDir) {
  try {
    if (!existsSync(path.join(workspaceDir, "node_modules"))) {
      npmExec(["install"], { cwd: workspaceDir, stdio: "ignore" });
    }
    npmExec(["run", "build"], { cwd: workspaceDir, encoding: "utf8" });
    return { ok: true };
  } catch (err) {
    return { ok: false, kind: "build", stderr: String(err.stderr || err.stdout || err.message || "") };
  }
}

/**
 * Runtime smoke against pack.canaryInput (exit 0 required).
 * Returns { ok, kind, stderr?, skipped? }.
 */
export function runCliCanary(workspaceDir, pack = null) {
  const p = pack || getActiveTaskPack();
  const cli = path.join(workspaceDir, "dist", "cli.js");
  if (!existsSync(cli)) {
    return { ok: false, kind: "canary", stderr: `Missing ${cli}` };
  }
  const result = spawnSync(process.execPath, [cli], {
    cwd: workspaceDir,
    input: p.canaryInput || "canary\n",
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) {
    return {
      ok: false,
      kind: "canary",
      stderr: String(result.error.message || result.error),
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      kind: "canary",
      stderr: String(result.stderr || result.stdout || `cli exit ${result.status}`).trim(),
    };
  }
  return { ok: true, kind: "canary" };
}

/**
 * Build then optional canary.
 * When pack.canaryRequireExit0 === false, canary is skipped (build-only).
 */
export function checkWorkspaceHealth(workspaceDir, pack = null) {
  const p = pack || getActiveTaskPack();
  const build = ensureBuilt(workspaceDir);
  if (!build.ok) {
    return { ok: false, kind: "build", stderr: build.stderr || "" };
  }
  if (p.canaryRequireExit0 === false) {
    return { ok: true, canarySkipped: true };
  }
  const canary = runCliCanary(workspaceDir, p);
  if (!canary.ok) {
    return { ok: false, kind: "canary", stderr: canary.stderr || "" };
  }
  return { ok: true };
}

export function truncateStderr(stderr, max = 1000) {
  const s = String(stderr || "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/**
 * Human-readable engineering error for planner ACTION_ERRORS / leaf summary.
 * @param {{ phase: string, kind: string, stderr?: string, taskId?: string, crossScopeLog?: string }} eng
 */
export function formatEngineeringError(eng, maxStderr = 1000) {
  const phase = eng?.phase || "engineering";
  const kind = eng?.kind || "unknown";
  const body = truncateStderr(eng?.stderr, maxStderr) || "(no stderr)";
  const prefix = eng?.taskId ? `${eng.taskId}: ` : "";
  let msg = `${prefix}${phase} ${kind} failed: ${body}`;
  const cross = String(eng?.crossScopeLog || "").trim();
  if (cross) {
    msg += `\nRecent cross-scope commits (git log --grep="cross-scope:"):\n${cross}`;
  }
  return msg;
}

/**
 * Attach engineering failure onto a worker report for tree + planner.
 */
export function attachEngineeringError(report, eng) {
  const message = formatEngineeringError(eng);
  const next = {
    ...(report || {}),
    status: "blocked",
    summary: message,
    engineering: {
      phase: eng.phase,
      kind: eng.kind,
    },
  };
  return {
    report: next,
    engineeringError: {
      phase: eng.phase,
      kind: eng.kind,
      stderr: eng.stderr || "",
      taskId: eng.taskId,
      crossScopeLog: eng.crossScopeLog || "",
      message,
    },
  };
}

/**
 * Shared DESIGN / diff / cross-scope context for integration-fix prompts.
 * Without this, the fixer is asked to update interfaces while seeing only stderr.
 */
export function formatHealthRepairContext({
  designMd = "",
  diff = "",
  crossScopeLog = "",
} = {}) {
  const parts = [
    "",
    "## DESIGN.md (current)",
    "```",
    truncateStderr(designMd, 4000) || "_None._",
    "```",
    "",
    "## Recent diff",
    "```",
    truncateStderr(diff, 6000) || "_No diff available._",
    "```",
  ];
  const cross = String(crossScopeLog || "").trim();
  if (cross) {
    parts.push(
      "",
      "## Recent cross-scope commits (git log --grep=\"cross-scope:\")",
      "```",
      truncateStderr(cross, 2000),
      "```",
      "If the failure is outside the files you expected, read these commits for the reason before patching.",
    );
  }
  return parts.join("\n");
}

/** Prompt for integration-fix role (pre- or post-merge). */
export function buildHealthRepairPrompt({
  kind,
  stderr,
  phase = "post-merge",
  designMd = "",
  diff = "",
  crossScopeLog = "",
} = {}) {
  const text = truncateStderr(stderr, 4000);
  const context = formatHealthRepairContext({ designMd, diff, crossScopeLog });
  if (kind === "canary") {
    return [
      `After ${phase}, \`node dist/cli.js\` fails the pack canary (startup / trivial stdin).`,
      "Fix the runtime import/init error with the smallest change. Update DESIGN.md / contracts.ts if interfaces changed.",
      "Do not look for external scoring oracles. Do not add import-time assertions that throw on module load.",
      "",
      "Runtime error:",
      "```",
      text,
      "```",
      context,
      "",
      "Say INTEGRATION_FIXED when done.",
    ].join("\n");
  }
  if (kind === "embedded") {
    return [
      `Harness self-check against **spec-embedded examples** (not the scoring suite) failed during ${phase}.`,
      "Fix the decoder/renderer so those normative examples agree, with the smallest change.",
      "Do not search for examples.json or external score signals.",
      "",
      "Self-check error:",
      "```",
      text,
      "```",
      context,
      "",
      "Say INTEGRATION_FIXED when done.",
    ].join("\n");
  }
  return [
    `The TypeScript build failed during ${phase}.`,
    "Fix compile errors with the smallest change. Update DESIGN.md / contracts.ts if interfaces changed.",
    "Do not look for external scoring oracles.",
    "",
    "Build error:",
    "```",
    text,
    "```",
    context,
    "",
    "Say INTEGRATION_FIXED when done.",
  ].join("\n");
}

/**
 * Shared leaf repair budget: health + embedded share one pool.
 * @returns {{ repairsLeft: number, consume: () => boolean }}
 */
export function createRepairBudget(maxAttempts) {
  let repairsLeft = Math.max(0, Number(maxAttempts) || 0);
  return {
    get repairsLeft() {
      return repairsLeft;
    },
    /** @returns {boolean} true if a repair slot was consumed */
    consume() {
      if (repairsLeft <= 0) return false;
      repairsLeft -= 1;
      return true;
    },
  };
}
