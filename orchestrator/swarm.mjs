#!/usr/bin/env node
/**
 * v13.8 Cursor-faithful swarm entry (S-A-008 alignment).
 * Event-driven planner/worker pipeline + run-to-done + hidden grader
 * + engineering feedback (build/canary/spec-embedded) to planner
 * + detach / heartbeat / checkpoint / resume
 * + serial Field Guide notes / CLI canary / planner ID remap
 * + observe_perfect / audit_converged / observe_plateau stop
 * + demand-driven width (frontier + merge backpressure) + seed-workspace
 * + wildcard empty-scope / DESIGN.md three-way merge / audit scope gate
 * + planner spawn-fail retry / waive evidence gate (v13.7.1)
 * + review-diff since lastReviewSha; integration-fix DESIGN/diff/cross-scope (v13.8).
 * Legacy test-driven pipeline remains in run.mjs / repair-engine.mjs.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, normalizeMaxTokensInOut, projectRoot, resolveModel } from "./lib/config.mjs";
import { finalizeRun } from "./lib/finalize.mjs";
import {
  abortMerge,
  cleanupInterruptedRun,
  commitAll,
  createWorktree,
  filesChangedInWorktree,
  getDiff,
  headSha,
  readDesign,
  recentCrossScopeLog,
  removeWorktree,
  resetHard,
  syncWorktreeWithMain,
} from "./lib/git.mjs";
import { powershellCommand, taskkillPid } from "./lib/win-exec.mjs";
import { appendGuideNote, readGuideIndex } from "./lib/guide.mjs";
import { ensureHoldout, holdoutFilePath } from "./lib/holdout.mjs";
import { extractJsonObject } from "./lib/json-parse.mjs";
import {
  buildSplitterPrompt,
  buildSwarmPlannerPrompt,
  buildSwarmWorkerPrompt,
} from "./lib/prompts.mjs";
import { formatFindingsForPlanner, runReviewStack } from "./lib/review-stack.mjs";
import {
  formatAuditCoverage,
  hasCodeChanges,
  auditScopeError,
  shouldRejectAuditAction,
  updateAuditState,
  auditConvergence,
  visibleWaiveCheck,
  waiveGateError,
} from "./lib/audit-convergence.mjs";
import { mergeDesign } from "./lib/design-merge.mjs";
import { isSpawnFailure } from "./lib/planner-spawn.mjs";
import {
  runCrossSectionSelfCheck,
  runEmbeddedSelfCheck,
} from "./lib/spec-embedded-check.mjs";
import { formatSpecToc, listSpecSections } from "./lib/spec-toc.mjs";
import {
  attachEngineeringError,
  buildHealthRepairPrompt,
  checkWorkspaceHealth,
  createRepairBudget,
  ensureBuilt,
  runCliCanary,
} from "./lib/swarm-health.mjs";
import {
  appliedActionsAreProductive,
  doneGateDecision,
  nextPerfectObserveStreak,
  nextStreaks,
  observePlateau,
  shouldStop,
  stopConsoleMessage,
} from "./lib/swarm-stop-policy.mjs";
import {
  backpressureCap,
  frontierDemand,
  nextNarrowFrontierStreak,
  scopeDisjoint,
} from "./lib/width-policy.mjs";
import {
  applyActions,
  createEmptyTree,
  formatTreeForPlanner,
  loadTree,
  markLeaf,
  readyLeaves,
  saveTree,
  treeStats,
} from "./lib/tree.mjs";
import {
  examplesPath,
  getReferenceText,
  scoreScope,
} from "./lib/verifier.mjs";
import { getActiveTaskPack, setActiveTaskPack } from "./lib/task-pack.mjs";
import {
  initSwarmSkeleton,
  initSwarmWorkspace,
  initSwarmWorkspaceFromSeed,
} from "./lib/workspace.mjs";
import { MergeQueue, checkScopeViolation, findOversizedFiles } from "./merge-queue.mjs";
import {
  activeWallMinutes,
  createMetricsCollector,
  loadMetricsSeed,
  totalTokensInOut,
} from "./metrics.mjs";
import { agentUsage, spawnAgent } from "./runner.mjs";

const SWARM_SCRIPT = fileURLToPath(import.meta.url);
const HEARTBEAT_STALE_MS = 2 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

function parseArgs(argv) {
  const args = {
    mock: false,
    runId: null,
    budgetMinutes: null,
    concurrency: null,
    runToDone: false,
    maxWallMinutes: null,
    maxTokens: null,
    detach: false,
    resume: false,
    task: "commonmark",
    widthMode: null,
    seedWorkspace: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--mock") args.mock = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--run-to-done") args.runToDone = true;
    else if (a === "--detach") args.detach = true;
    else if (a === "--resume") args.resume = true;
    else if (a === "--run-id") args.runId = argv[++i];
    else if (a.startsWith("--run-id=")) args.runId = a.slice("--run-id=".length);
    else if (a === "--task") args.task = argv[++i];
    else if (a.startsWith("--task=")) args.task = a.slice("--task=".length);
    else if (a === "--budget-minutes") args.budgetMinutes = Number(argv[++i]);
    else if (a.startsWith("--budget-minutes=")) args.budgetMinutes = Number(a.slice("--budget-minutes=".length));
    else if (a === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (a.startsWith("--concurrency=")) args.concurrency = Number(a.slice("--concurrency=".length));
    else if (a === "--max-wall-minutes") args.maxWallMinutes = Number(argv[++i]);
    else if (a.startsWith("--max-wall-minutes=")) args.maxWallMinutes = Number(a.slice("--max-wall-minutes=".length));
    else if (a === "--max-tokens") args.maxTokens = Number(argv[++i]);
    else if (a.startsWith("--max-tokens=")) args.maxTokens = Number(a.slice("--max-tokens=".length));
    else if (a === "--width-mode") args.widthMode = argv[++i];
    else if (a.startsWith("--width-mode=")) args.widthMode = a.slice("--width-mode=".length);
    else if (a === "--seed-workspace") args.seedWorkspace = argv[++i];
    else if (a.startsWith("--seed-workspace=")) args.seedWorkspace = a.slice("--seed-workspace=".length);
  }
  return args;
}

function usage() {
  console.log(`Usage: node orchestrator/swarm.mjs [options]
  --run-id=ID
  --task=commonmark|toml-json   Task pack (default commonmark)
  --budget-minutes=N   Wall-clock budget when not --run-to-done (default config.swarm.budgetMinutes)
  --run-to-done        Run until planner declares done (hard stop: maxWallMinutes)
  --max-wall-minutes=N Hard safety stop for --run-to-done (default config.swarm.maxWallMinutes)
  --max-tokens=N       Optional hard stop on sum(tokens_in+tokens_out); default unlimited (no cache)
  --concurrency=N      Max parallel leaves (demand width) or target width (fixed mode)
  --width-mode=demand|fixed   Concurrency policy (default config.swarm.widthMode)
  --seed-workspace=PATH  Seed main workspace from an existing solo/swarm workspace
  --detach             Respawn as a detached process (console.log + swarm.pid); exit parent
  --resume             Resume an interrupted run (requires --run-id)
  --mock               Scripted planner/worker; no LLM
  --help`);
}

async function runIntegrationFixAgent({
  workspaceDir,
  config,
  runDir,
  metrics,
  taskId,
  kind,
  stderr,
  phase,
  logKey,
}) {
  const prompt = buildHealthRepairPrompt({
    kind,
    stderr,
    phase,
    designMd: readDesign(workspaceDir),
    diff: getDiff(workspaceDir),
    crossScopeLog: recentCrossScopeLog(workspaceDir),
  });
  const result = await spawnAgent({
    role: "integration-fix",
    prompt,
    cwd: workspaceDir,
    config,
    runDir,
    logKey,
    timeoutMs: (config.taskTimeoutMinutes || 20) * 60 * 1000,
  });
  metrics.recordAgentCall({
    role: "integration-fix",
    taskId,
    ok: result.ok,
    ...agentUsage(result),
  });
  metrics.recordIntegrationFix?.({ taskId, ok: result.ok, kind, phase });
  return result;
}

/**
 * Pre-merge health + embedded self-check with shared repair budget.
 * @returns {{ ok: true, checked: number } | { ok: false, engineeringError, report }}
 */
async function gateLeafBeforeMerge({
  wtPath,
  task,
  report,
  config,
  runDir,
  metrics,
  mock,
  codeChanged = false,
  seed = null,
}) {
  if (mock) return { ok: true, checked: 0 };

  const swarm = config.swarm || {};
  const budget = createRepairBudget(swarm.leafHealthRepairAttempts ?? 1);
  const maxExamples = swarm.harnessSelfCheckExamples ?? 5;
  const crossExamples = swarm.harnessCrossCheckExamples ?? 5;
  const maxChars = swarm.specTextMaxChars ?? 64000;
  const seedBase = seed != null ? String(seed) : `${task.id}:${task.attempts || 0}`;

  const tryRepair = async (kind, stderr, phase) => {
    if (!budget.consume()) return false;
    await runIntegrationFixAgent({
      workspaceDir: wtPath,
      config,
      runDir,
      metrics,
      taskId: task.id,
      kind,
      stderr,
      phase,
      logKey: `swarm-leaf-health-${task.id}-${kind}`,
    });
    commitAll(wtPath, `leaf-health: ${kind} fix ${task.id}`);
    return true;
  };

  let health = checkWorkspaceHealth(wtPath);
  if (!health.ok) {
    const repaired = await tryRepair(health.kind, health.stderr, "pre-merge");
    if (repaired) health = checkWorkspaceHealth(wtPath);
    if (!health.ok) {
      const attached = attachEngineeringError(report, {
        phase: "pre-merge",
        kind: health.kind || "build",
        stderr: health.stderr || "",
        taskId: task.id,
        crossScopeLog: recentCrossScopeLog(wtPath),
      });
      return { ok: false, ...attached };
    }
  }

  let embedded = runEmbeddedSelfCheck({
    workspaceDir: wtPath,
    sections: task.spec_sections || [],
    maxExamples,
    maxChars,
    seed: seedBase,
  });
  if (!embedded.ok) {
    const repaired = await tryRepair("embedded", embedded.stderr, "pre-merge");
    if (repaired) {
      // Rebuild after embedded fix before re-check.
      health = checkWorkspaceHealth(wtPath);
      if (!health.ok) {
        const attached = attachEngineeringError(report, {
          phase: "pre-merge",
          kind: health.kind || "build",
          stderr: health.stderr || "",
          taskId: task.id,
          crossScopeLog: recentCrossScopeLog(wtPath),
        });
        return { ok: false, ...attached };
      }
      embedded = runEmbeddedSelfCheck({
        workspaceDir: wtPath,
        sections: task.spec_sections || [],
        maxExamples,
        maxChars,
        seed: `${seedBase}:retry`,
      });
    }
    if (!embedded.ok) {
      const attached = attachEngineeringError(report, {
        phase: "pre-merge",
        kind: "embedded",
        stderr: embedded.stderr || "",
        taskId: task.id,
      });
      return { ok: false, ...attached };
    }
  }

  let checked = Number(embedded.checked) || 0;

  if (codeChanged && crossExamples > 0) {
    let cross = runCrossSectionSelfCheck({
      workspaceDir: wtPath,
      excludeSections: task.spec_sections || [],
      maxExamples: crossExamples,
      maxChars,
      seed: `${seedBase}:cross`,
    });
    if (!cross.ok) {
      const repaired = await tryRepair("embedded", cross.stderr, "pre-merge-cross");
      if (repaired) {
        health = checkWorkspaceHealth(wtPath);
        if (!health.ok) {
          const attached = attachEngineeringError(report, {
            phase: "pre-merge-cross",
            kind: health.kind || "build",
            stderr: health.stderr || "",
            taskId: task.id,
            crossScopeLog: recentCrossScopeLog(wtPath),
          });
          return { ok: false, ...attached };
        }
        cross = runCrossSectionSelfCheck({
          workspaceDir: wtPath,
          excludeSections: task.spec_sections || [],
          maxExamples: crossExamples,
          maxChars,
          seed: `${seedBase}:cross-retry`,
        });
      }
      if (!cross.ok) {
        const attached = attachEngineeringError(report, {
          phase: "pre-merge-cross",
          kind: "embedded-cross",
          stderr: cross.stderr || "",
          taskId: task.id,
        });
        return { ok: false, ...attached };
      }
    }
    checked += Number(cross.checked) || 0;
  }

  if (checked > 0) {
    metrics.data.harness_self_check_total = (metrics.data.harness_self_check_total || 0) + checked;
  }
  return { ok: true, checked };
}

/**
 * Validate the merged main workspace and roll back the entire merge (including
 * attempted integration fixes) when the configured repair budget is exhausted.
 */
async function gateMainAfterMerge({
  mergeResult,
  workspaceDir,
  config,
  runDir,
  metrics,
  taskId,
  sections = [],
  regressionSections = [],
  mock = false,
}) {
  if (mock) return { ok: true, checked: 0 };

  const swarm = config.swarm || {};
  const maxRepairs = Math.max(0, Number(swarm.postMergeRepairAttempts) || 0);
  const maxExamples = Math.max(0, Number(swarm.postMergeEmbeddedExamples) || 0);
  const crossExamples = regressionSections.length > 0
    ? Math.max(0, Number(swarm.harnessCrossCheckExamples) || 0)
    : 0;
  const maxChars = swarm.specTextMaxChars ?? 64000;
  const preSha = mergeResult?.preSha;

  const check = (attempt) => {
    const health = checkWorkspaceHealth(workspaceDir);
    if (!health.ok) {
      return {
        ok: false,
        kind: health.kind || "build",
        stderr: health.stderr || "",
        canary: health.kind === "canary",
      };
    }
    const embedded = runEmbeddedSelfCheck({
      workspaceDir,
      sections,
      maxExamples,
      maxChars,
      seed: `${taskId}:post-merge:${attempt}`,
    });
    if (!embedded.ok) return { ...embedded, kind: "embedded" };
    if (crossExamples > 0) {
      const crossResult = runEmbeddedSelfCheck({
        workspaceDir,
        sections: regressionSections,
        maxExamples: crossExamples,
        maxChars,
        seed: `${taskId}:post-merge-cross:${attempt}`,
      });
      if (!crossResult.ok) return crossResult;
      return {
        ok: true,
        checked: (Number(embedded.checked) || 0) + (Number(crossResult.checked) || 0),
      };
    }
    return { ok: true, checked: Number(embedded.checked) || 0 };
  };

  let gate = check(0);
  for (let attempt = 1; !gate.ok && attempt <= maxRepairs; attempt += 1) {
    await runIntegrationFixAgent({
      workspaceDir,
      config,
      runDir,
      metrics,
      taskId,
      kind: gate.kind === "embedded-cross" ? "embedded" : (gate.kind || "post-merge"),
      stderr: gate.stderr || "",
      phase: "post-merge-gate",
      logKey: `swarm-post-merge-${taskId}-${attempt}`,
    });
    commitAll(workspaceDir, `post-merge: integration fix ${taskId}`);
    gate = check(attempt);
  }

  if (gate.ok) {
    if (gate.checked > 0) {
      metrics.data.harness_self_check_total =
        (metrics.data.harness_self_check_total || 0) + gate.checked;
    }
    return { ...gate, verifiedSha: headSha(workspaceDir) };
  }

  const failedSha = headSha(workspaceDir);
  metrics.recordPostMergeGateFailure?.({
    taskId,
    kind: gate.kind || "post-merge",
    attempts: maxRepairs,
    preSha,
    failedSha,
  });
  if (!preSha) {
    throw new Error(`post-merge gate failed for ${taskId} without preSha`);
  }
  resetHard(workspaceDir, preSha);
  const rolledBack = headSha(workspaceDir) === preSha;
  if (!rolledBack) {
    throw new Error(`post-merge rollback failed for ${taskId} to ${preSha}`);
  }
  metrics.checkpoint();
  return {
    ...gate,
    ok: false,
    preSha,
    failedSha,
    rolledBack,
    attempts: maxRepairs,
  };
}

function abortLeftoverMerge(workspaceDir, label = "swarm") {
  const mergeHead = path.join(workspaceDir, ".git", "MERGE_HEAD");
  if (!existsSync(mergeHead)) return false;
  console.warn(`[${label}] aborting leftover MERGE_HEAD before finalize`);
  abortMerge(workspaceDir);
  if (existsSync(mergeHead)) {
    try { rmSync(mergeHead, { force: true }); } catch { /* ignore */ }
  }
  return true;
}

function dumpPlannerParseFail(runDir, logRound, text, suffix = "") {
  try {
    const name = `planner-parse-fail-${logRound}${suffix}.txt`;
    writeFileSync(path.join(runDir, name), String(text || ""), "utf8");
  } catch {
    /* ignore */
  }
}

function uncoveredSections(tree) {
  const done = new Set(completedSections(tree));
  const waived = new Set(tree.waived_sections || []);
  return listSpecSections().filter((s) => !done.has(s) && !waived.has(s));
}

function completedSections(tree) {
  const done = new Set();
  for (const n of Object.values(tree.nodes || {})) {
    if (n.kind === "leaf" && n.status === "done") {
      for (const s of n.spec_sections || []) done.add(s);
    }
  }
  return [...done];
}

/**
 * Mark a section as a synthetic done leaf + audit clean credit (v13.7).
 */
function addSeedLeaf(tree, section, { n, checked = 1, sha = null } = {}) {
  const id = `seed-${n}`;
  tree.nodes[id] = {
    id,
    kind: "leaf",
    title: `Seeded from solo baseline: ${section}`,
    parent: null,
    deps: [],
    status: "done",
    files_scope: [],
    spec_sections: [section],
    notes: "seeded from solo baseline",
    report: { summary: "embedded examples pass at seed time" },
    attempts: 0,
    total_attempts: 0,
    verified: { sha, checked },
  };
  if (!tree.audit_state || typeof tree.audit_state !== "object") tree.audit_state = {};
  tree.audit_state[section] = { clean: 1 };
}

/**
 * Seed coverage ledger from an already-built workspace (solo→swarm escalate).
 * Sections whose embedded examples all pass become synthetic done leaves.
 * @returns {string[]} seeded section names
 */
function seedCoverageFromWorkspace({
  tree,
  workspaceDir,
  swarm,
  taskPack,
}) {
  const health = checkWorkspaceHealth(workspaceDir, taskPack);
  if (!health.ok) {
    console.warn(`[swarm] seed coverage skipped: workspace health failed (${health.kind || "unknown"})`);
    return [];
  }
  const seeded = [];
  let n = 0;
  for (const section of listSpecSections()) {
    const result = runEmbeddedSelfCheck({
      workspaceDir,
      sections: [section],
      maxExamples: swarm.harnessSelfCheckExamples,
      pack: taskPack,
      seed: "ladder-seed",
    });
    if (!(result.checked > 0 && result.ok)) continue;
    n += 1;
    addSeedLeaf(tree, section, {
      n,
      checked: result.checked,
      sha: headSha(workspaceDir),
    });
    seeded.push(section);
  }
  return seeded;
}

/** Mock-only seed: credit first two sections so ladder mock exercises audit_state. */
function seedCoverageMock(tree) {
  const sections = listSpecSections().slice(0, 2);
  let n = 0;
  for (const section of sections) {
    n += 1;
    addSeedLeaf(tree, section, { n, checked: 1, sha: null });
  }
  return sections;
}

function formatCoverage(tree, swarm = {}) {
  const uncovered = uncoveredSections(tree);
  const waived = tree.waived_sections || [];
  const lines = [];
  if (!uncovered.length) {
    lines.push("All sections covered or waived.");
  } else {
    lines.push(`Uncovered sections (no completed leaf, not waived): ${uncovered.join(", ")}`);
  }
  if (waived.length) {
    lines.push(`Waived: ${waived.join(", ")}`);
  }
  const auditLines = formatAuditCoverage(tree, swarm, listSpecSections());
  if (auditLines) lines.push(auditLines);
  return lines.join("\n");
}

function formatBudgetLine(swarm, startedAtMs, hardDeadlineMs, metricsData = null) {
  const elapsedMin = Math.max(0, Math.floor((Date.now() - startedAtMs) / 60000));
  let wall;
  if (swarm.runToDone) {
    const hardMin = Math.max(0, Math.ceil((hardDeadlineMs - startedAtMs) / 60000));
    wall = `No fixed deadline. Elapsed: ${elapsedMin} min. Hard safety stop at ${hardMin} min.`;
  } else {
    const remaining = Math.max(0, Math.ceil((hardDeadlineMs - Date.now()) / 60000));
    wall = `Wall-clock remaining: ${remaining} minutes.`;
  }
  const cap = normalizeMaxTokensInOut(swarm.maxTokensInOut);
  if (cap == null) return wall;
  const used = totalTokensInOut(metricsData);
  return `${wall} Tokens: ${used}/${cap} (in+out, no cache).`;
}

function mockPlannerActions(tree, round) {
  if (round === 0 && !Object.keys(tree.nodes).length) {
    const pack = getActiveTaskPack();
    if (pack.id === "toml-json") {
      return {
        design_md: [
          "# Design",
          "",
          "Pipeline: lex/parse TOML → tagged JSON (toml-test shape).",
          "Register value parsers in values/registry; table handlers in tables/registry.",
          "contracts.ts mirrors public interfaces.",
          "",
        ].join("\n"),
        actions: [
          { type: "add_plan_node", id: "plan-01", title: "TOML core", parent: null },
          {
            type: "add_task",
            id: "task-01",
            title: "Integers + parse entry",
            parent: "plan-01",
            files_scope: ["src/parse.ts", "src/index.ts"],
            spec_sections: ["Integers"],
            notes: "Accept integer assignments into tagged JSON.",
          },
          {
            type: "add_task",
            id: "task-02",
            title: "Booleans",
            parent: "plan-01",
            deps: [],
            files_scope: ["src/values/bool.ts", "src/values/registry.ts"],
            spec_sections: ["Booleans"],
            notes: "Register boolean value parser.",
          },
        ],
        rationale: "mock initial toml tree",
      };
    }
    return {
      design_md: [
        "# Design",
        "",
        "Pipeline: parse blocks → parse inlines → render HTML.",
        "Register parsers in blocks/registry and inline/registry.",
        "contracts.ts mirrors public interfaces.",
        "",
      ].join("\n"),
      actions: [
        { type: "add_plan_node", id: "plan-01", title: "CommonMark core", parent: null },
        {
          type: "add_task",
          id: "task-01",
          title: "Paragraphs + textual content",
          parent: "plan-01",
          files_scope: ["src/index.ts", "src/render.ts"],
          spec_sections: ["Paragraphs", "Textual content"],
          notes: "Basic paragraph rendering.",
        },
        {
          type: "add_task",
          id: "task-02",
          title: "ATX headings",
          parent: "plan-01",
          deps: [],
          files_scope: ["src/blocks/atx.ts", "src/blocks/registry.ts"],
          spec_sections: ["ATX headings"],
          notes: "Register ATX heading parser.",
        },
      ],
      rationale: "mock initial tree",
    };
  }
  const actions = [];
  // v13.7: intentionally emit a scopeless audit so harness rejection is exercised in mock.
  if (round === 1) {
    actions.push({
      type: "add_task",
      id: "audit-mock-noscope",
      title: "audit: mock no-scope (should be rejected)",
      files_scope: [],
      spec_sections: uncoveredSections(tree).slice(0, 1),
      notes: "mock: empty files_scope must be rejected",
    });
  }
  for (const section of uncoveredSections(tree)) {
    actions.push({ type: "waive_section", section, reason: "mock waive" });
  }
  actions.push({ type: "done" });
  return { actions, rationale: "mock done" };
}

function mockWorkerReport(task) {
  return {
    status: "done",
    summary: `mock completed ${task.id}`,
    oversized_files: [],
    guide_note: `mock note for ${task.id}`,
    self_checked: 2,
  };
}

function observeScore({ workspaceDir, runDir, metrics, label }) {
  const scorePath = path.join(runDir, `score-observe-${label}.json`);
  const scored = scoreScope(workspaceDir, scorePath, {
    holdoutFile: holdoutFilePath(runDir),
    holdoutMode: "exclude",
  });
  metrics.recordScore({ phase: `observe-${label}`, ...scored.report });
  return scored.report;
}

function writeHeartbeat(runDir, payload) {
  writeFileSync(path.join(runDir, "heartbeat.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function isHeartbeatFresh(runDir) {
  const p = path.join(runDir, "heartbeat.json");
  if (!existsSync(p)) return false;
  try {
    const hb = JSON.parse(readFileSync(p, "utf8"));
    const at = Date.parse(hb.at);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < HEARTBEAT_STALE_MS;
  } catch {
    return false;
  }
}

function killOrphanAgents(runDir) {
  if (process.platform !== "win32") return { killed: [] };
  const killed = [];
  // Match only processes whose command line embeds this runDir (avoids scanning
  // every node.exe on the machine — that CIM dump can hang for minutes).
  const needle = runDir.replace(/\//g, "\\").replace(/'/g, "''");
  try {
    const ps = [
      `$n='${needle}'.ToLower()`,
      "Get-CimInstance Win32_Process |",
      "  Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($n) -and $_.Name -match 'cursor-agent|node|cmd' } |",
      "  Select-Object -ExpandProperty ProcessId",
    ].join(" ");
    const out = powershellCommand(ps, {
      timeout: 60000,
      maxBuffer: 2 * 1024 * 1024,
    });
    for (const line of String(out).split(/\r?\n/)) {
      const pid = Number(line.trim());
      if (!pid || pid === process.pid) continue;
      try {
        taskkillPid(pid);
        killed.push(pid);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* best-effort */
  }
  return { killed };
}

function detachSelf(cli, runId, runDir) {
  mkdirSync(runDir, { recursive: true });
  const consolePath = path.join(runDir, "console.log");
  const fd = openSync(consolePath, "a");
  const childArgs = [SWARM_SCRIPT];
  // Rebuild argv without --detach; ensure --run-id is present.
  const raw = process.argv.slice(2).filter((a) => a !== "--detach");
  let hasRunId = false;
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === "--run-id" || raw[i].startsWith("--run-id=")) hasRunId = true;
  }
  if (!hasRunId) {
    raw.push(`--run-id=${runId}`);
  }
  childArgs.push(...raw);

  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: ["ignore", fd, fd],
    cwd: projectRoot(),
    env: process.env,
    windowsHide: true,
  });
  writeFileSync(path.join(runDir, "swarm.pid"), `${child.pid}\n`, "utf8");
  child.unref();
  console.log(`[swarm] detached pid=${child.pid} run-id=${runId}`);
  console.log(`[swarm] monitor: ${consolePath}`);
  console.log(`[swarm] heartbeat: ${path.join(runDir, "heartbeat.json")}`);
  process.exit(0);
}

function resetRunningLeaves(tree) {
  let n = 0;
  for (const node of Object.values(tree.nodes || {})) {
    if (node.kind !== "leaf" || node.status !== "running") continue;
    node.status = "pending";
    node.attempts = Math.max(0, (node.attempts || 1) - 1);
    n += 1;
  }
  return n;
}

async function invitePlanner({
  tree,
  workspaceDir,
  config,
  runDir,
  metrics,
  mock,
  workerReports,
  reviewFindings,
  actionErrors,
  coverage,
  budgetLine,
  maxConcurrency,
  logRound,
}) {
  const swarm = config.swarm;
  if (mock) {
    const parsed = mockPlannerActions(tree, Math.max(0, (tree.planner_rounds || 1) - 1));
    metrics.recordAgentCall({
      role: "swarm-planner",
      ok: true,
      elapsedMs: 0,
      model: "mock",
      tokens_in: 0,
      tokens_out: 0,
    });
    return parsed;
  }

  const prompt = buildSwarmPlannerPrompt({
    specToc: formatSpecToc(),
    treeSummary: formatTreeForPlanner(tree),
    designMd: readDesign(workspaceDir),
    guideIndex: readGuideIndex(workspaceDir, { maxLines: swarm.guideMaxLines }),
    workerReports: workerReports || "_None yet._",
    reviewFindings: reviewFindings || "_None yet._",
    coverage: coverage || "_None._",
    actionErrors: actionErrors || "_None._",
    budgetLine: budgetLine || "_None._",
    maxConcurrency,
    maxTreeDepth: swarm.maxTreeDepth,
  });
  const timeoutMs = (config.taskTimeoutMinutes || 20) * 60 * 1000;
  const spawnPlanner = (logKey) => spawnAgent({
    role: "swarm-planner",
    prompt,
    cwd: workspaceDir,
    config,
    runDir,
    logKey,
    timeoutMs,
  });

  let result = await spawnPlanner(`swarm-planner-${logRound}`);
  metrics.recordAgentCall({
    role: "swarm-planner",
    ok: result.ok,
    ...agentUsage(result),
  });

  // v13.7.1: empty/failed spawn is NOT a parse failure — retry once, never json-repair.
  if (isSpawnFailure(result)) {
    metrics.data.planner_spawn_failures = (metrics.data.planner_spawn_failures || 0) + 1;
    console.warn("[swarm] planner spawn failed (empty or ok=false); retrying once");
    result = await spawnPlanner(`swarm-planner-${logRound}-retry`);
    metrics.recordAgentCall({
      role: "swarm-planner",
      ok: result.ok,
      ...agentUsage(result),
    });
    if (isSpawnFailure(result)) {
      metrics.data.planner_spawn_failures = (metrics.data.planner_spawn_failures || 0) + 1;
      console.warn("[swarm] planner spawn failed after retry; skipping json-repair");
      dumpPlannerParseFail(runDir, logRound, result.output || "", "-spawn");
      return null;
    }
  }

  let parsed = extractJsonObject(result.output || "");
  if (parsed) return parsed;

  // One cheap JSON-repair retry (role falls back to worker model).
  // Only reached with non-empty malformed output. cwd=runDir to limit fabrication surface.
  console.warn("[swarm] planner JSON parse failed; attempting json-repair");
  dumpPlannerParseFail(runDir, logRound, result.output || "");
  const repairPrompt = [
    "The following text was supposed to be a single JSON object for a swarm planner.",
    "Fix it so it is valid JSON with keys design_md (optional), actions (array), rationale (string).",
    "Output ONLY the JSON object — no markdown fences, no prose.",
    "",
    "Broken output:",
    "```",
    String(result.output || "").slice(0, 30000),
    "```",
  ].join("\n");
  const repair = await spawnAgent({
    role: "json-repair",
    prompt: repairPrompt,
    cwd: runDir,
    config,
    runDir,
    logKey: `swarm-planner-${logRound}-json-repair`,
    timeoutMs: Math.min(timeoutMs, 5 * 60 * 1000),
  });
  metrics.recordAgentCall({
    role: "json-repair",
    ok: repair.ok,
    ...agentUsage(repair),
  });
  parsed = extractJsonObject(repair.output || "");
  if (parsed) return parsed;

  console.warn("[swarm] planner JSON parse failed after repair");
  dumpPlannerParseFail(runDir, logRound, repair.output || result.output || "", "-repair");

  // Same-role compact retry (configured swarm-planner model; no model switch).
  if (swarm.plannerCompactRetry !== false) {
    console.warn("[swarm] planner compact retry (same role)");
    const treeSnap = formatTreeForPlanner(tree).slice(0, 6000);
    const compactPrompt = [
      "Your previous swarm-planner output was not valid JSON.",
      "Reply with ONLY a single JSON object. No markdown fences, no prose.",
      'Required shape: { "actions": [ ... ], "rationale": "..." }',
      "Do NOT include design_md. Prefer requeue_task / add_task / waive_section.",
      "Keep actions under 12 items.",
      "",
      "Current task tree (truncated):",
      treeSnap,
      "",
      "Recent action errors:",
      String(actionErrors || "_None._").slice(0, 2000),
      "",
      "Broken output (truncated):",
      "```",
      String(repair.output || result.output || "").slice(0, 12000),
      "```",
    ].join("\n");
    const compact = await spawnAgent({
      role: "swarm-planner",
      prompt: compactPrompt,
      cwd: workspaceDir,
      config,
      runDir,
      logKey: `swarm-planner-${logRound}-compact`,
      timeoutMs: Math.min((config.taskTimeoutMinutes || 20) * 60 * 1000, 5 * 60 * 1000),
    });
    metrics.recordAgentCall({
      role: "swarm-planner",
      ok: compact.ok,
      ...agentUsage(compact),
    });
    parsed = extractJsonObject(compact.output || "");
    if (parsed) return parsed;
    dumpPlannerParseFail(runDir, logRound, compact.output || "", "-compact");
    console.warn("[swarm] planner JSON parse failed after compact retry");
  }

  return null;
}

function blockedLeafIds(tree) {
  return Object.values(tree.nodes || {})
    .filter((n) => n.kind === "leaf" && n.status === "blocked")
    .map((n) => n.id);
}

function harnessRequeueBlocked(tree, limit, maxTotalLeafAttempts) {
  const ids = blockedLeafIds(tree).slice(0, Math.max(0, limit));
  if (!ids.length) return { requeued: [], errors: [] };
  const actions = ids.map((id) => ({ type: "requeue_task", id }));
  const results = applyActions(tree, actions, { maxTotalLeafAttempts });
  return {
    requeued: ids.filter((_, i) => results[i]?.ok),
    errors: results.filter((r) => !r.ok).map((r) => r.error),
  };
}

async function runSplitter({
  workspaceDir,
  worktreesRoot,
  config,
  runDir,
  metrics,
  mergeQueue,
  oversized,
  mock,
  onMainMutation,
  regressionSections = [],
}) {
  const files = (oversized || []).map((o) => (typeof o === "string" ? o : `${o.file} (${o.lines} lines)`));
  const splitId = `split-${Date.now()}`;
  if (mock) {
    metrics.recordAgentCall({ role: "splitter", ok: true, elapsedMs: 0, model: "mock" });
    return { status: "done", summary: "mock split skipped" };
  }

  const wt = createWorktree(workspaceDir, worktreesRoot, splitId);
  try {
    const prompt = buildSplitterPrompt({
      oversizedFiles: files,
      designMd: readDesign(wt.path),
      oversizedLines: config.swarm.oversizedFileLines,
    });
    const result = await spawnAgent({
      role: "splitter",
      prompt,
      cwd: wt.path,
      config,
      runDir,
      logKey: `splitter-${splitId}`,
      timeoutMs: (config.taskTimeoutMinutes || 20) * 60 * 1000,
    });
    metrics.recordAgentCall({
      role: "splitter",
      ok: result.ok,
      ...agentUsage(result),
    });
    commitAll(wt.path, "split: oversized files");
    const mergeResult = await mergeQueue.enqueue({
      branch: wt.branch,
      taskId: splitId,
      afterMerge: async (result) => {
        const gate = await gateMainAfterMerge({
          mergeResult: result,
          workspaceDir,
          config,
          runDir,
          metrics,
          taskId: splitId,
          sections: [],
          regressionSections,
          mock,
        });
        if (gate.ok) onMainMutation?.();
        return gate;
      },
    });
    if (!mergeResult.ok || mergeResult.postMerge?.ok === false) {
      return {
        status: "blocked",
        summary: mergeResult.postMerge?.rolledBack
          ? "splitter merge failed post-merge validation and was rolled back"
          : "splitter merge failed",
      };
    }
    return extractJsonObject(result.output || "") || { status: result.ok ? "done" : "blocked" };
  } finally {
    removeWorktree(workspaceDir, wt.path);
  }
}

async function executeLeaf({
  task,
  workspaceDir,
  worktreesRoot,
  config,
  runDir,
  metrics,
  mergeQueue,
  mock,
  hardDeadlineMs,
  onMainMutation,
  regressionSections = [],
}) {
  if (Date.now() >= hardDeadlineMs) {
    return { task, ok: false, report: { status: "blocked", summary: "budget exhausted before dispatch" } };
  }

  const swarm = config.swarm;
  const started = Date.now();
  metrics.recordTask({ id: task.id, status: "in_progress", started_at: new Date().toISOString() });

  const wt = createWorktree(workspaceDir, worktreesRoot, task.id);
  const sections = task.spec_sections || [];
  const specText = sections.map((g) => getReferenceText(g, swarm.specTextMaxChars)).filter(Boolean).join("\n\n")
    || "_No sections assigned — follow DESIGN.md._";

  let report;
  if (mock) {
    const notePath = path.join(wt.path, "src", `mock-${task.id}.ts`);
    writeFileSync(notePath, `// mock leaf ${task.id}\nexport const mock_${task.id.replace(/-/g, "_")} = true;\n`, "utf8");
    commitAll(wt.path, `mock ${task.id}`);
    report = mockWorkerReport(task);
    metrics.recordAgentCall({
      role: "worker",
      taskId: task.id,
      ok: true,
      elapsedMs: 1,
      model: "mock",
    });
  } else {
    const prompt = buildSwarmWorkerPrompt({
      task,
      specText,
      designMd: readDesign(wt.path),
      guideIndex: readGuideIndex(wt.path, { maxLines: swarm.guideMaxLines }),
      oversizedLines: swarm.oversizedFileLines,
    });
    const result = await spawnAgent({
      role: "worker",
      prompt,
      cwd: wt.path,
      config,
      runDir,
      logKey: `swarm-worker-${task.id}`,
      timeoutMs: (config.taskTimeoutMinutes || 20) * 60 * 1000,
    });
    metrics.recordAgentCall({
      role: "worker",
      taskId: task.id,
      ok: result.ok,
      ...agentUsage(result),
    });
    commitAll(wt.path, `worker ${task.id}`);
    report = extractJsonObject(result.output || "") || {
      status: result.ok ? "done" : "blocked",
      summary: result.ok ? "no JSON report" : `agent exit ${result.code}`,
      oversized_files: [],
      self_checked: 0,
    };
  }

  metrics.data.self_check_total = (metrics.data.self_check_total || 0) + (Number(report.self_checked) || 0);

  const changed = filesChangedInWorktree(wt.path);
  const codeChanged = hasCodeChanges(changed);
  const localOver = findOversizedFiles(wt.path, changed, swarm.oversizedFileLines);
  if (localOver.length && report.status !== "oversized") {
    report.status = "oversized";
    report.oversized_files = localOver.map((o) => o.file);
  }

  const violations = checkScopeViolation(changed, task.files_scope, { allowDesign: true });
  const realViolations = violations.filter((f) => !f.startsWith("guide/") && f !== "GUIDE.md");
  if (realViolations.length) {
    metrics.recordCrossScopeChange({ taskId: task.id, files: realViolations });
  }

  if (report.status === "oversized" || report.status === "blocked") {
    removeWorktree(workspaceDir, wt.path);
    metrics.recordTask({
      id: task.id,
      status: "failed",
      elapsedMs: Date.now() - started,
      report,
    });
    return { task, ok: false, report, oversized: report.status === "oversized", codeChanged };
  }

  const gate = await gateLeafBeforeMerge({
    wtPath: wt.path,
    task,
    report,
    config,
    runDir,
    metrics,
    mock,
    // Cross-section checks belong on the persistent post-merge main state.
    // Running them on an early leaf's incomplete worktree rejects valid
    // feature work merely because unrelated sections are not implemented yet.
    codeChanged: false,
    seed: `${task.id}:m${Date.now()}`,
  });
  if (!gate.ok) {
    removeWorktree(workspaceDir, wt.path);
    metrics.recordTask({
      id: task.id,
      status: "failed",
      elapsedMs: Date.now() - started,
      report: gate.report,
    });
    return {
      task,
      ok: false,
      report: gate.report,
      engineeringError: gate.engineeringError,
      codeChanged,
    };
  }
  if (gate.checked > 0) {
    report = {
      ...report,
      self_checked: Math.max(Number(report.self_checked) || 0, gate.checked),
    };
  }

  const sync = syncWorktreeWithMain(wt.path);
  if (sync.conflict) abortMerge(wt.path);
  metrics.recordWorktreeSync({ taskId: task.id, conflict: !!sync.conflict });

  let mergeResult;
  try {
    mergeResult = await mergeQueue.enqueue({
      branch: wt.branch,
      taskId: task.id,
      afterMerge: async (result) => {
        const postMerge = await gateMainAfterMerge({
          mergeResult: result,
          workspaceDir,
          config,
          runDir,
          metrics,
          taskId: task.id,
          sections: task.spec_sections || [],
          regressionSections: codeChanged ? regressionSections : [],
          mock,
        });
        if (postMerge.ok) onMainMutation?.();
        return postMerge;
      },
    });
  } catch (err) {
    removeWorktree(workspaceDir, wt.path);
    const attached = attachEngineeringError(report, {
      phase: "merge",
      kind: "merge",
      stderr: String(err?.message || err),
      taskId: task.id,
    });
    metrics.recordTask({
      id: task.id,
      status: "failed",
      elapsedMs: Date.now() - started,
      report: attached.report,
    });
    return {
      task,
      ok: false,
      report: attached.report,
      engineeringError: attached.engineeringError,
    };
  }
  removeWorktree(workspaceDir, wt.path);

  if (mergeResult.oversized) {
    metrics.recordTask({
      id: task.id,
      status: "failed",
      elapsedMs: Date.now() - started,
      report: { ...report, status: "oversized", oversized_files: mergeResult.oversized_files },
    });
    return {
      task,
      ok: false,
      report: { ...report, status: "oversized", oversized_files: mergeResult.oversized_files },
      oversized: true,
      mergeResult,
    };
  }

  if (!mergeResult.ok) {
    const attached = attachEngineeringError(report, {
      phase: "merge",
      kind: "merge",
      stderr: mergeResult.message
        || (mergeResult.conflict ? "merge conflict unresolved" : "merge failed"),
      taskId: task.id,
    });
    metrics.recordTask({
      id: task.id,
      status: "failed",
      elapsedMs: Date.now() - started,
      report: attached.report,
      merge: { ok: false, oversized: false },
    });
    return {
      task,
      ok: false,
      report: attached.report,
      engineeringError: attached.engineeringError,
      mergeResult,
    };
  }

  if (mergeResult.postMerge?.ok === false) {
    const pm = mergeResult.postMerge;
    const attached = attachEngineeringError(report, {
      phase: "post-merge",
      kind: pm.kind || (pm.canary ? "canary" : "build"),
      stderr: pm.stderr || "",
      taskId: task.id,
    });
    metrics.recordTask({
      id: task.id,
      status: "failed",
      elapsedMs: Date.now() - started,
      report: attached.report,
      merge: { ok: true, oversized: false, postMerge: false },
    });
    return {
      task,
      ok: false,
      report: attached.report,
      engineeringError: attached.engineeringError,
      mergeResult,
    };
  }

  if (report.guide_note) {
    try {
      await mergeQueue.enqueueFn(() => {
        appendGuideNote(workspaceDir, `[${task.id}] ${report.guide_note}`);
        commitAll(workspaceDir, `guide: note from ${task.id}`);
      }, "guide-note");
    } catch (err) {
      console.warn(`[swarm] guide-note append failed for ${task.id}: ${err?.message || err}`);
    }
  }
  metrics.recordTask({
    id: task.id,
    status: "done",
    elapsedMs: Date.now() - started,
    report,
    merge: { ok: true, oversized: false },
  });
  return { task, ok: true, report, mergeResult, codeChanged };
}

function trackPromise(set, promise) {
  set.add(promise);
  const cleanup = () => set.delete(promise);
  promise.then(cleanup, cleanup);
  return promise;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    usage();
    process.exit(0);
  }
  if (cli.resume && !cli.runId) {
    console.error("[swarm] --resume requires --run-id");
    process.exit(1);
  }

  let taskPack;
  try {
    taskPack = setActiveTaskPack(cli.task || "commonmark");
  } catch (err) {
    console.error(`[swarm] ${err.message || err}`);
    process.exit(1);
  }

  const config = loadConfig({
    swarm: taskPack.swarmOverrides || {},
  });
  if (cli.concurrency != null && !Number.isNaN(cli.concurrency)) {
    config.swarm.concurrency = cli.concurrency;
    config.concurrency = cli.concurrency;
  }
  if (cli.widthMode === "demand" || cli.widthMode === "fixed") {
    config.swarm.widthMode = cli.widthMode;
  }
  if (cli.budgetMinutes != null && !Number.isNaN(cli.budgetMinutes)) {
    config.swarm.budgetMinutes = cli.budgetMinutes;
  }
  if (cli.runToDone) config.swarm.runToDone = true;
  if (cli.maxWallMinutes != null && !Number.isNaN(cli.maxWallMinutes)) {
    config.swarm.maxWallMinutes = cli.maxWallMinutes;
  }
  if (cli.maxTokens != null && !Number.isNaN(cli.maxTokens)) {
    config.swarm.maxTokensInOut = normalizeMaxTokensInOut(cli.maxTokens);
  }

  config.coordination = true;

  const swarm = config.swarm;
  const runId = cli.runId || `swarm-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = path.join(projectRoot(), "runs", runId);

  if (cli.detach) {
    detachSelf(cli, runId, runDir);
    return;
  }

  const workspaceDir = path.join(runDir, "workspace");
  const worktreesRoot = path.join(runDir, "worktrees");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "swarm.pid"), `${process.pid}\n`, "utf8");

  let tree;
  let metrics;
  let startedAtMs;
  let hardDeadlineMs;
  let mergeSuccessCount = 0;
  let resumeNotice = false;

  if (cli.resume) {
    if (!existsSync(path.join(runDir, "tree.json"))) {
      console.error(`[swarm] cannot resume: missing tree.json in ${runDir}`);
      process.exit(1);
    }
    if (isHeartbeatFresh(runDir)) {
      console.error("[swarm] refuse --resume: heartbeat.json updated within 2 minutes (process may still be alive)");
      process.exit(1);
    }
    console.log(`[swarm] resume cleanup for ${runId}`);
    const orphans = killOrphanAgents(runDir);
    if (orphans.killed.length) console.log(`[swarm] killed orphan pids: ${orphans.killed.join(", ")}`);
    const clean = cleanupInterruptedRun(workspaceDir, worktreesRoot);
    console.log(
      `[swarm] git cleanup: abortedMerge=${clean.abortedMerge} lock=${clean.removedLock}`
        + ` worktrees=${clean.worktreesRemoved.length} branches=${clean.branchesDeleted.length}`,
    );

    tree = loadTree(runDir);
    const resetN = resetRunningLeaves(tree);
    saveTree(runDir, tree);
    console.log(`[swarm] reset ${resetN} running leaves → pending`);

    const seed = loadMetricsSeed(runDir);
    metrics = createMetricsCollector(runDir, { seed: seed || undefined, resume: true });
    mergeSuccessCount = Object.values(tree.nodes || {}).filter(
      (n) => n.kind === "leaf" && n.status === "done",
    ).length;
    metrics.data.quality_merge_count = Number.isFinite(Number(seed?.quality_merge_count))
      ? Number(seed.quality_merge_count)
      : mergeSuccessCount;
    const consumed = activeWallMinutes(metrics.data);
    const budgetMin = swarm.runToDone ? swarm.maxWallMinutes : swarm.budgetMinutes;
    const remaining = Math.max(5, budgetMin - consumed);
    startedAtMs = Date.now();
    hardDeadlineMs = startedAtMs + remaining * 60 * 1000;
    resumeNotice = true;
    ensureHoldout(runDir, examplesPath(), config);
  } else {
    metrics = createMetricsCollector(runDir);
    startedAtMs = Date.now();
    hardDeadlineMs = startedAtMs + (swarm.runToDone ? swarm.maxWallMinutes : swarm.budgetMinutes) * 60 * 1000;
    if (cli.seedWorkspace) {
      const seedAbs = path.isAbsolute(cli.seedWorkspace)
        ? cli.seedWorkspace
        : path.join(projectRoot(), cli.seedWorkspace);
      initSwarmWorkspaceFromSeed(workspaceDir, seedAbs, { guideMaxLines: swarm.guideMaxLines });
    } else {
      initSwarmWorkspace(workspaceDir, { guideMaxLines: swarm.guideMaxLines });
      initSwarmSkeleton(workspaceDir, { mock: cli.mock, skeleton: taskPack.skeleton });
    }
    ensureHoldout(runDir, examplesPath(), config);
    tree = createEmptyTree();
    let seededSections = [];
    if (cli.seedWorkspace) {
      seededSections = cli.mock
        ? seedCoverageMock(tree)
        : seedCoverageFromWorkspace({
          tree,
          workspaceDir,
          swarm,
          taskPack,
        });
      console.log(`[swarm] seeded ${seededSections.length} sections from ${cli.seedWorkspace}`);
    }
    saveTree(runDir, tree);
    if (cli.seedWorkspace) {
      metrics.setMeta({
        seed_workspace: cli.seedWorkspace,
        seeded_sections: seededSections,
      });
    }
  }

  metrics.setMeta({
    coordination: true,
    coordination_mode: "faithful-swarm",
    planner_source: cli.mock ? "mock-swarm" : "swarm-planner",
    task_set: "swarm-tree",
    task_pack: taskPack.id,
    swarm: true,
    architecture: "v13.8-swarm",
    width_mode: swarm.widthMode,
    run_to_done: !!swarm.runToDone,
    resumed: !!cli.resume,
  });

  const tokenCapLog = normalizeMaxTokensInOut(swarm.maxTokensInOut);
  console.log(
    `[swarm] id=${runId} task=${taskPack.id} mock=${cli.mock} resume=${cli.resume} runToDone=${swarm.runToDone}`
      + ` hardStop=${swarm.runToDone ? swarm.maxWallMinutes : swarm.budgetMinutes}m`
      + ` maxTokens=${tokenCapLog == null ? "none" : tokenCapLog}`
      + ` concurrency=${swarm.concurrency}`,
  );
  console.log(`[swarm] planner=${resolveModel(config, "swarm-planner")} worker=${resolveModel(config, "worker")}`);

  const mergeQueue = new MergeQueue({
    mainDir: workspaceDir,
    config,
    runDir,
    metrics,
    coordination: true,
    resolveWithMerger: true,
  });

  /** @type {Map<string, Promise>} */
  const running = new Map();
  /** @type {Set<Promise>} */
  const auxJobs = new Set();
  let plannerPromise = null;
  let pendingReports = [];
  let pendingFindings = [];
  let actionErrors = [];
  let mergesSinceReview = 0;
  /** Left side of next review-diff; advances after each review stack. */
  let lastReviewSha = metrics.data.last_review_sha || null;
  if (!lastReviewSha && !cli.resume) {
    lastReviewSha = headSha(workspaceDir) || null;
  }
  let sinceObserve = 0;
  let parseFailStreak = Number(metrics.data.parse_fail_streak) || 0;
  let unproductiveStreak = Number(metrics.data.unproductive_streak) || 0;
  let blockedRescueWaves = Number(metrics.data.blocked_rescue_waves) || 0;
  let perfectObserveStreak = Number(metrics.data.perfect_observe_streak) || 0;
  let auditConvergedPlannerRounds = Number(metrics.data.audit_converged_planner_rounds) || 0;
  let lastWidthRecorded = null;
  let narrowFrontierStreak = 0;
  let qualityMergeCount = Number(metrics.data.quality_merge_count);
  if (!Number.isFinite(qualityMergeCount)) qualityMergeCount = mergeSuccessCount;
  let lastObserve = metrics.data.last_observe && typeof metrics.data.last_observe === "object"
    ? { ...metrics.data.last_observe }
    : null;
  let observeHistory = Array.isArray(metrics.data.observe_history)
    ? [...metrics.data.observe_history]
    : [];
  let stopReason = null;
  let reviewInFlight = false;
  let observeInFlight = false;
  let forceObserve = false;
  /** @type {Map<string, any>} */
  const leafResults = new Map();
  let acceptLeafResults = true;
  let plannerResult = null;
  let plannerSettled = false;
  /** Snapshots to restore if planner returns null. */
  let plannerSnap = null;

  function checkpointStopPolicy() {
    metrics.data.parse_fail_streak = parseFailStreak;
    metrics.data.unproductive_streak = unproductiveStreak;
    metrics.data.blocked_rescue_waves = blockedRescueWaves;
    metrics.data.perfect_observe_streak = perfectObserveStreak;
    metrics.data.audit_converged_planner_rounds = auditConvergedPlannerRounds;
    metrics.data.quality_merge_count = qualityMergeCount;
    metrics.data.last_observe = lastObserve;
    metrics.data.observe_history = observeHistory;
    if (stopReason) metrics.data.stop_reason = stopReason;
  }

  function currentDoneGate() {
    return doneGateDecision({
      mock: cli.mock,
      minObserveRateForDone: swarm.minObserveRateForDone,
      lastObserve,
      mergeCount: qualityMergeCount,
    });
  }

  function auditConvergedNow() {
    const grace = Number(swarm.auditConvergedGraceRounds) || 0;
    if (grace <= 0 && Number(swarm.auditCleanConvergeThreshold) === 0) return false;
    if (uncoveredSections(tree).length) return false;
    const { allConverged } = auditConvergence(tree, swarm, listSpecSections());
    return allConverged;
  }

  function auditQuiesce() {
    const grace = Number(swarm.auditConvergedGraceRounds) || 0;
    if (grace <= 0) return false;
    return currentDoneGate() === "accept"
      && auditConvergedNow()
      && auditConvergedPlannerRounds >= grace;
  }

  function requestStop(reason) {
    stopReason = reason;
    metrics.data.stop_reason = reason;
    if (reason === "idle_tree" || reason === "observe_plateau") {
      metrics.data.stop_observe_rate = lastObserve?.rate ?? null;
    }
    checkpointStopPolicy();
    console.log(stopConsoleMessage(reason));
  }

  function noteMainMutation() {
    qualityMergeCount += 1;
    checkpointStopPolicy();
  }

  function applySuccessfulLeafResult(out, { drained = false } = {}) {
    const taskId = out?.task?.id;
    const node = tree.nodes[taskId];
    if (!taskId || !node || node.kind !== "leaf" || node.status === "done") return false;
    const report = out.report || {};
    markLeaf(tree, taskId, "done", report, {
      verified: {
        sha: out.mergeResult?.postMerge?.verifiedSha || headSha(workspaceDir),
        checked: Number(out.mergeResult?.postMerge?.checked) || 0,
      },
    });
    updateAuditState(tree, out.task, !!out.codeChanged);
    mergeSuccessCount += 1;
    mergesSinceReview += 1;
    sinceObserve += 1;
    if (drained) {
      metrics.data.drain_reconciled_done = (metrics.data.drain_reconciled_done || 0) + 1;
    }
    if (!auditConvergedNow()) {
      auditConvergedPlannerRounds = 0;
    }
    checkpointStopPolicy();
    return true;
  }

  function scheduleObserve(reason = "periodic") {
    if (observeInFlight || stopReason) return null;
    observeInFlight = true;
    forceObserve = false;
    sinceObserve = 0;
    const requestedAt = qualityMergeCount;
    const label = `m${requestedAt}-${reason}`;
    const job = mergeQueue.enqueueFn(() => {
      const atMergeCount = qualityMergeCount;
      const report = observeScore({ workspaceDir, runDir, metrics, label });
      perfectObserveStreak = nextPerfectObserveStreak(perfectObserveStreak, report);
      lastObserve = {
        rate: report?.rate ?? null,
        total: Number(report?.total) || 0,
        passed: Number(report?.passed) || 0,
        atMergeCount,
      };
      observeHistory.push(lastObserve);
      forceObserve = false;
      checkpointStopPolicy();
      metrics.checkpoint({
        tree_stats: treeStats(tree),
        swarm_planner_rounds: tree.planner_rounds,
      });
      if (report && report.total > 0 && report.passed === 0) {
        const canary = runCliCanary(workspaceDir);
        const hint = (canary.stderr || "cli canary failed").split("\n")[0].slice(0, 160);
        console.warn(`[swarm] observe redline: zero passes (m${atMergeCount}); canary=${canary.ok}`);
        actionErrors.push(
          `URGENT: main workspace CLI appears broken (observe all-fail). `
            + `Schedule a fix task immediately. Hint: ${hint}`,
        );
      }
      return { kind: "observe", report };
    }, `observe-${label}`).finally(() => {
      observeInFlight = false;
    });
    trackPromise(auxJobs, job);
    return job;
  }

  async function drainInflightAfterStop(graceMs = 30000) {
    const pending = [...running.values(), plannerPromise, ...auxJobs].filter(Boolean);
    let timedOut = false;
    if (pending.length) {
      console.log(`[swarm] draining ${pending.length} in-flight jobs (grace ${graceMs}ms)`);
      await Promise.race([
        Promise.allSettled(pending),
        new Promise((resolve) => {
          setTimeout(() => {
            timedOut = true;
            resolve();
          }, graceMs);
        }),
      ]);
    }
    if (timedOut) console.warn("[swarm] drain grace elapsed; continuing finalize");

    for (const [taskId, out] of [...leafResults.entries()]) {
      leafResults.delete(taskId);
      running.delete(taskId);
      if (out?.ok) {
        applySuccessfulLeafResult(out, { drained: true });
      } else {
        const node = tree.nodes[taskId];
        if (node?.kind === "leaf" && node.status === "running") {
          markLeaf(tree, taskId, "pending", out?.report || null);
          metrics.recordTask({
            id: taskId,
            status: "pending",
            drain_reset: true,
          });
          metrics.data.drain_reset_pending = (metrics.data.drain_reset_pending || 0) + 1;
        }
      }
    }

    acceptLeafResults = false;
    const unresolvedIds = [...running.keys()];
    const resetN = resetRunningLeaves(tree);
    for (const taskId of unresolvedIds) {
      const node = tree.nodes[taskId];
      if (node?.kind === "leaf" && node.status === "pending") {
        metrics.recordTask({
          id: taskId,
          status: "pending",
          drain_reset: true,
        });
      }
    }
    if (resetN) {
      metrics.data.drain_reset_pending = (metrics.data.drain_reset_pending || 0) + resetN;
      console.log(`[swarm] reset ${resetN} unsettled in-flight leaves → pending after drain`);
    }
    running.clear();
    plannerPromise = null;
    plannerSettled = false;
    plannerResult = null;
    saveTree(runDir, tree);
    metrics.checkpoint({
      tree_stats: treeStats(tree),
      swarm_planner_rounds: tree.planner_rounds,
    });
  }

  if (resumeNotice) {
    actionErrors.push("run resumed after interruption; recent worker reports may be missing");
  }

  const heartbeatTimer = setInterval(() => {
    try {
      writeHeartbeat(runDir, {
        at: new Date().toISOString(),
        pid: process.pid,
        elapsed_min: Math.floor((Date.now() - startedAtMs) / 60000),
        running_leaves: [...running.keys()],
        aux_jobs: auxJobs.size,
        planner_in_flight: !!plannerPromise,
        merge_success_count: mergeSuccessCount,
        planner_rounds: tree.planner_rounds,
        tree: treeStats(tree),
      });
      metrics.checkpoint({
        tree_stats: treeStats(tree),
        swarm_planner_rounds: tree.planner_rounds,
      });
    } catch (err) {
      console.warn(`[swarm] heartbeat/checkpoint failed: ${err.message}`);
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();

  writeHeartbeat(runDir, {
    at: new Date().toISOString(),
    pid: process.pid,
    elapsed_min: 0,
    running_leaves: [],
    aux_jobs: 0,
    planner_in_flight: false,
    merge_success_count: mergeSuccessCount,
    planner_rounds: tree.planner_rounds,
    tree: treeStats(tree),
  });

  try {
    while (true) {
      const pastDeadline = Date.now() >= hardDeadlineMs;
      const tokenCap = normalizeMaxTokensInOut(swarm.maxTokensInOut);
      const pastTokenBudget = tokenCap != null && totalTokensInOut(metrics.data) >= tokenCap;
      const perfectStopAt = Number(swarm.observePerfectStreakToStop) || 0;
      const pastPerfectObserve = perfectStopAt > 0 && perfectObserveStreak >= perfectStopAt;
      const pastAuditQuiesce = auditQuiesce();
      const observeIsFresh = Number(lastObserve?.atMergeCount) === qualityMergeCount;
      const pastObservePlateau = observeIsFresh
        && currentDoneGate() === "accept"
        && uncoveredSections(tree).length === 0
        && observePlateau(
          observeHistory,
          swarm.observePlateauWindow,
          swarm.observeMinGainPp,
        );
      const pastBudget = pastDeadline
        || pastTokenBudget
        || pastPerfectObserve
        || pastAuditQuiesce
        || pastObservePlateau;
      const readyNow = () => readyLeaves(tree).filter((n) => (
        (n.attempts || 0) < swarm.maxLeafAttempts
        && (n.total_attempts || 0) < swarm.maxTotalLeafAttempts
      ));
      let currentConcurrency;
      let demandForCurve = null;
      let capForCurve = null;
      if (swarm.widthMode === "fixed") {
        // v13.5 original behavior (endgameConcurrency only in this branch)
        currentConcurrency = Math.max(
          1,
          Number(
            uncoveredSections(tree).length === 0
              ? swarm.endgameConcurrency
              : swarm.concurrency,
          ) || 1,
        );
      } else {
        const runningLeavesNow = [...running.keys()].map((id) => tree.nodes[id]).filter(Boolean);
        const demand = frontierDemand(runningLeavesNow, readyNow());
        const waitsMs = (metrics.data.merge_waits || [])
          .filter((w) => w.label === "merge")
          .slice(-swarm.backpressureWindow)
          .map((w) => Number(w.waitMs) || 0);
        const cap = backpressureCap({
          waitsMs,
          window: swarm.backpressureWindow,
          mediumSec: swarm.mergeWaitMediumSec,
          highSec: swarm.mergeWaitHighSec,
          maxConcurrency: swarm.concurrency,
        });
        demandForCurve = demand;
        capForCurve = cap;
        currentConcurrency = Math.max(1, Math.min(swarm.concurrency, demand, cap));
      }
      if (currentConcurrency !== lastWidthRecorded) {
        metrics.data.width_curve = metrics.data.width_curve || [];
        metrics.data.width_curve.push({
          at: new Date().toISOString(),
          width: currentConcurrency,
          demand: demandForCurve,
          cap: capForCurve,
          running: running.size,
          ready: readyNow().length,
        });
        lastWidthRecorded = currentConcurrency;
      }
      const idle = running.size === 0 && auxJobs.size === 0 && !plannerPromise;

      if (
        tree.done
        && idle
        && readyNow().length === 0
      ) {
        requestStop("planner_done");
        break;
      }
      if (pastPerfectObserve && idle) {
        requestStop("observe_perfect");
        break;
      }
      if (pastAuditQuiesce && idle) {
        requestStop("audit_converged");
        break;
      }
      if (pastObservePlateau && idle) {
        requestStop("observe_plateau");
        break;
      }
      if (pastDeadline && idle) {
        requestStop("wall_budget");
        break;
      }
      if (pastTokenBudget && idle) {
        requestStop("token_budget");
        break;
      }
      {
        const stop = shouldStop({
          parseFailStreak,
          unproductiveStreak,
          maxPlannerParseFails: swarm.maxPlannerParseFails,
          maxUnproductivePlannerRounds: swarm.maxUnproductivePlannerRounds,
        });
        if (stop.stop && idle) {
          if (stop.reason !== "idle_tree" || currentDoneGate() === "accept") {
            requestStop(stop.reason);
            break;
          }
          const qualityDecision = currentDoneGate();
          actionErrors.push(
            qualityDecision === "defer_stale"
              ? "idle stop deferred: hidden quality observation is stale; observe scheduled"
              : "idle stop deferred: hidden quality gate not met; schedule focused fixes or audits",
          );
          unproductiveStreak = 0;
          if (qualityDecision === "defer_stale") forceObserve = true;
          checkpointStopPolicy();
        }
      }

      if (!pastBudget) {
        while (running.size < currentConcurrency) {
          const runningLeavesNow = [...running.keys()].map((id) => tree.nodes[id]).filter(Boolean);
          const candidates = readyNow().filter((n) => !running.has(n.id)
            && (swarm.widthMode === "fixed" || scopeDisjoint(n, runningLeavesNow)));
          if (!candidates.length) break;
          const leaf = candidates[0];
          markLeaf(tree, leaf.id, "running");
          saveTree(runDir, tree);
          const p = executeLeaf({
            task: leaf,
            workspaceDir,
            worktreesRoot,
            config,
            runDir,
            metrics,
            mergeQueue,
            mock: cli.mock,
            hardDeadlineMs,
            onMainMutation: noteMainMutation,
            regressionSections: completedSections(tree),
          }).then((out) => {
            if (acceptLeafResults) leafResults.set(leaf.id, out);
            return { kind: "leaf", taskId: leaf.id };
          });
          running.set(leaf.id, p);
        }
      }

      const treeEmpty = Object.keys(tree.nodes).length === 0;
      const stalled = running.size === 0 && readyNow().length === 0;
      const shouldInvitePlanner = !plannerPromise
        && !tree.done
        && !pastBudget
        && (treeEmpty || pendingReports.length >= swarm.plannerReportBatch || stalled);

      if (shouldInvitePlanner) {
        if (swarm.widthMode !== "fixed") {
          narrowFrontierStreak = nextNarrowFrontierStreak(narrowFrontierStreak, {
            uncovered: uncoveredSections(tree).length,
            frontierSize: readyNow().length + running.size,
          });
          if (narrowFrontierStreak >= swarm.narrowFrontierAdvisoryRounds) {
            actionErrors.push(
              "Frontier is narrow (fewer than 2 ready+running leaves) while sections remain uncovered. If independent sections exist, decompose them into separate leaves with disjoint files_scope. Do not create filler tasks.",
            );
            narrowFrontierStreak = 0;
          }
        }
        const reportsSnap = pendingReports.splice(0);
        const findingsSnap = pendingFindings.splice(0);
        const errorsSnap = actionErrors.splice(0);
        plannerSnap = {
          reportsSnap,
          findingsSnap,
          errorsSnap,
          designBase: readDesign(workspaceDir),
        };
        tree.planner_rounds += 1;
        metrics.data.swarm_planner_rounds = tree.planner_rounds;
        const logRound = tree.planner_rounds;
        const reportsText = reportsSnap.length ? reportsSnap.join("\n") : "_None yet._";
        const errorsText = errorsSnap.length
          ? errorsSnap.map((e, i) => `${i + 1}. ${e}`).join("\n")
          : "_None._";
        plannerSettled = false;
        plannerResult = null;
        plannerPromise = invitePlanner({
          tree,
          workspaceDir,
          config,
          runDir,
          metrics,
          mock: cli.mock,
          workerReports: reportsText,
          reviewFindings: formatFindingsForPlanner(findingsSnap),
          actionErrors: errorsText,
          coverage: formatCoverage(tree, swarm),
          budgetLine: formatBudgetLine(swarm, startedAtMs, hardDeadlineMs, metrics.data),
          maxConcurrency: swarm.concurrency,
          logRound,
        }).then((plan) => {
          plannerResult = plan;
          plannerSettled = true;
          return { kind: "planner" };
        });
      }

      if (
        !pastBudget
        && !reviewInFlight
        && swarm.reviewEveryNMerges > 0
        && mergesSinceReview >= swarm.reviewEveryNMerges
      ) {
        mergesSinceReview = 0;
        reviewInFlight = true;
        const afterMerges = mergeSuccessCount;
        const reviewJob = (async () => {
          try {
            if (cli.mock) {
              const findings = [{ severity: "low", perspective: "mock", summary: "mock review finding" }];
              pendingFindings.push(...findings);
              const sinceSha = lastReviewSha;
              const tip = headSha(workspaceDir);
              if (tip) {
                lastReviewSha = tip;
                metrics.data.last_review_sha = tip;
              }
              metrics.data.reviews = metrics.data.reviews || [];
              metrics.data.reviews.push({
                at: new Date().toISOString(),
                after_merges: afterMerges,
                since_sha: sinceSha || null,
                tip_sha: tip || null,
                findings,
              });
              return { kind: "review" };
            }
            console.log(`[swarm] review stack after ${afterMerges} merges`);
            const snapId = `review-${afterMerges}`;
            const wt = createWorktree(workspaceDir, worktreesRoot, snapId);
            try {
              const sinceSha = lastReviewSha;
              const stack = await runReviewStack({
                workspaceDir: wt.path,
                config,
                runDir,
                metrics,
                perspectives: swarm.reviewPerspectives,
                sinceSha,
              });
              pendingFindings.push(...stack.findings);
              const tip = headSha(wt.path) || headSha(workspaceDir);
              if (tip) {
                lastReviewSha = tip;
                metrics.data.last_review_sha = tip;
              }
              metrics.data.reviews = metrics.data.reviews || [];
              metrics.data.reviews.push({
                at: new Date().toISOString(),
                after_merges: afterMerges,
                since_sha: sinceSha || null,
                tip_sha: tip || null,
                findings: stack.findings,
              });
            } finally {
              removeWorktree(workspaceDir, wt.path);
            }
            return { kind: "review" };
          } finally {
            reviewInFlight = false;
          }
        })();
        trackPromise(auxJobs, reviewJob);
      }

      if (
        !pastBudget
        && !observeInFlight
        && (forceObserve || (
          swarm.observeScoreEveryMerges > 0
          && sinceObserve >= swarm.observeScoreEveryMerges
        ))
      ) {
        scheduleObserve(forceObserve ? "done-gate" : "periodic");
      }

      const inflight = [
        ...running.values(),
        plannerPromise,
        ...auxJobs,
      ].filter(Boolean);

      if (!inflight.length) {
        continue;
      }

      await Promise.race(inflight);

      for (const taskId of [...leafResults.keys()]) {
        const out = leafResults.get(taskId);
        leafResults.delete(taskId);
        running.delete(taskId);

        // After stop, ignore late worker settles so resetRunningLeaves stays authoritative.
        if (stopReason) continue;

        let report = out.report || {};
        const attempts = tree.nodes[taskId]?.attempts || 0;

        if (out.ok) {
          applySuccessfulLeafResult(out);
        } else if (out.oversized) {
          markLeaf(tree, out.task.id, "blocked", report);
          const splitJob = (async () => {
            if (stopReason) return { kind: "splitter" };
            const split = await runSplitter({
              workspaceDir,
              worktreesRoot,
              config,
              runDir,
              metrics,
              mergeQueue,
              oversized: report?.oversized_files || out.mergeResult?.oversized_files || [],
              mock: cli.mock,
              onMainMutation: noteMainMutation,
              regressionSections: completedSections(tree),
            });
            metrics.data.splits = metrics.data.splits || [];
            metrics.data.splits.push({
              taskId: out.task.id,
              at: new Date().toISOString(),
              result: split,
            });
            markLeaf(tree, out.task.id, "pending", report);
            saveTree(runDir, tree);
            return { kind: "splitter" };
          })();
          trackPromise(auxJobs, splitJob);
        } else {
          if (attempts >= swarm.maxLeafAttempts) {
            report = {
              ...report,
              summary: `attempts exhausted; ${String(report.summary || "")}`,
            };
          }
          markLeaf(tree, out.task.id, "blocked", report);
        }

        if (out.engineeringError?.message) {
          actionErrors.push(out.engineeringError.message);
        }

        pendingReports.push(
          `- ${out.task.id}: ${report?.status || (out.ok ? "done" : "failed")} — ${String(report?.summary || "").slice(0, 200)}`,
        );
        saveTree(runDir, tree);
        metrics.checkpoint({
          tree_stats: treeStats(tree),
          swarm_planner_rounds: tree.planner_rounds,
        });
      }

      if (plannerSettled && plannerPromise) {
        const plan = plannerResult;
        plannerPromise = null;
        plannerSettled = false;
        plannerResult = null;

        if (stopReason) continue;

        if (plan == null) {
          // Roll back spliced queues so the next invite sees them.
          metrics.data.planner_parse_failures = (metrics.data.planner_parse_failures || 0) + 1;
          if (plannerSnap) {
            pendingReports.unshift(...plannerSnap.reportsSnap);
            pendingFindings.unshift(...plannerSnap.findingsSnap);
            actionErrors.unshift(...plannerSnap.errorsSnap);
            plannerSnap = null;
          }
          actionErrors.push("planner JSON parse failed (queues restored)");
          const next = nextStreaks({
            parseOk: false,
            productive: false,
            stalled: false,
            blockedCount: 0,
            blockedRescueWaves,
            maxBlockedRescueWaves: swarm.maxBlockedRescueWaves,
            parseFailStreak,
            unproductiveStreak,
          });
          parseFailStreak = next.parseFailStreak;
          // unproductiveStreak intentionally unchanged on parse fail
          checkpointStopPolicy();
          metrics.checkpoint({
            tree_stats: treeStats(tree),
            swarm_planner_rounds: tree.planner_rounds,
            parse_fail_streak: parseFailStreak,
            unproductive_streak: unproductiveStreak,
          });
          continue;
        }
        const designBase = plannerSnap?.designBase ?? "";
        plannerSnap = null;

        if (plan.design_md && typeof plan.design_md === "string" && plan.design_md.trim()) {
          const theirs = plan.design_md;
          await mergeQueue.enqueueFn(() => {
            const ours = readDesign(workspaceDir);
            const result = mergeDesign({ base: designBase, ours, theirs });
            if (result.conflict) {
              metrics.data.design_write_conflicts = (metrics.data.design_write_conflicts || 0) + 1;
              actionErrors.push(result.summary || "DESIGN.md merge conflict; kept main version");
              console.warn(`[swarm] ${result.summary || "DESIGN.md merge conflict"}`);
              return;
            }
            if (result.merged != null && result.merged !== ours) {
              writeFileSync(path.join(workspaceDir, "DESIGN.md"), result.merged, "utf8");
              commitAll(workspaceDir, "planner: update DESIGN.md");
            }
          }, "design-update");
        }

        const actions = Array.isArray(plan.actions) ? [...plan.actions] : [];

        const doneActions = actions.filter((a) => a?.type === "done");
        const { rejectSections } = auditConvergence(tree, swarm, listSpecSections());
        const enforceAuditReject = currentDoneGate() === "accept";
        const preDoneActions = [];
        for (const a of actions.filter((x) => x?.type !== "done")) {
          const scopeErr = auditScopeError(a);
          if (scopeErr) {
            actionErrors.push(scopeErr);
            console.warn(`[swarm] ${scopeErr}`);
            continue;
          }
          if (a?.type === "waive_section") {
            const section = typeof a.section === "string" ? a.section.trim() : "";
            const slug = section.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "")
              || "unknown";
            const checkResult = cli.mock
              ? { ok: true, checked: 0, skipped: true }
              : visibleWaiveCheck(
                  section,
                  scoreScope(
                    workspaceDir,
                    path.join(runDir, `score-waive-${tree.planner_rounds}-${slug}.json`),
                    {
                      groups: [section].filter(Boolean),
                      holdoutFile: holdoutFilePath(runDir),
                      holdoutMode: "exclude",
                      maxFailures: 20,
                    },
                  ),
                );
            const waiveErr = waiveGateError(a, checkResult);
            if (waiveErr) {
              actionErrors.push(waiveErr);
              console.warn(`[swarm] ${waiveErr}`);
              continue;
            }
          }
          const rej = shouldRejectAuditAction(a, rejectSections, {
            enforce: enforceAuditReject,
          });
          if (rej.reject) {
            actionErrors.push(rej.reason);
            console.warn(`[swarm] ${rej.reason}`);
            continue;
          }
          if (rej.advisory) {
            actionErrors.push(rej.reason);
            console.log(`[swarm] ${rej.reason}`);
          }
          preDoneActions.push(a);
        }
        const preResults = applyActions(tree, preDoneActions, {
          maxTreeDepth: swarm.maxTreeDepth,
          maxTotalLeafAttempts: swarm.maxTotalLeafAttempts,
        });
        for (const r of preResults) {
          if (!r.ok) {
            console.warn(`[swarm] action failed: ${r.error}`);
            actionErrors.push(r.error);
          } else if (r.remapped && r.from) {
            console.warn(`[swarm] remapped duplicate id ${r.from} → ${r.id}`);
          }
        }

        if (doneActions.length) {
          const uncovered = uncoveredSections(tree);
          const pendingOrRunning = Object.values(tree.nodes).filter(
            (n) => n.kind === "leaf" && (n.status === "pending" || n.status === "running"),
          );
          const busy = running.size > 0 || pendingOrRunning.length > 0;
          if (uncovered.length) {
            actionErrors.push(`done rejected: uncovered sections: ${uncovered.join(", ")}`);
          } else if (busy) {
            actionErrors.push("done rejected: leaves still pending or running");
          } else {
            const qualityDecision = currentDoneGate();
            if (qualityDecision === "defer_stale") {
              actionErrors.push("done deferred: hidden quality observation is stale; observe scheduled");
              forceObserve = true;
              scheduleObserve("done-gate");
            } else if (qualityDecision === "reject_below_gate") {
              actionErrors.push("done rejected: hidden quality gate not met; schedule focused fixes or audits");
            } else {
              const doneResults = applyActions(tree, doneActions, {
                maxTreeDepth: swarm.maxTreeDepth,
                maxTotalLeafAttempts: swarm.maxTotalLeafAttempts,
              });
              for (const r of doneResults) {
                if (!r.ok) {
                  console.warn(`[swarm] action failed: ${r.error}`);
                  actionErrors.push(r.error);
                }
              }
            }
          }
        }

        if (auditConvergedNow() && !tree.done) {
          auditConvergedPlannerRounds += 1;
        } else if (!auditConvergedNow()) {
          auditConvergedPlannerRounds = 0;
        }

        const readyAfter = readyNow().length;
        const productive = appliedActionsAreProductive(preDoneActions, preResults, tree.done);
        const stalledAfter = running.size === 0 && readyAfter === 0 && !tree.done;
        const blockedIds = blockedLeafIds(tree);
        const next = nextStreaks({
          parseOk: true,
          productive,
          stalled: stalledAfter,
          blockedCount: blockedIds.length,
          blockedRescueWaves,
          maxBlockedRescueWaves: swarm.maxBlockedRescueWaves,
          parseFailStreak,
          unproductiveStreak,
        });
        if (next.didRescue) {
          const rescue = harnessRequeueBlocked(
            tree,
            currentConcurrency,
            swarm.maxTotalLeafAttempts,
          );
          actionErrors.push(`harness requeued blocked: ${rescue.requeued.join(", ") || "(none)"}`);
          actionErrors.push(...rescue.errors);
          console.log(
            `[swarm] harness rescue wave ${next.blockedRescueWaves}:`
              + ` requeued ${rescue.requeued.length} blocked leaves`,
          );
        }
        parseFailStreak = next.parseFailStreak;
        unproductiveStreak = next.unproductiveStreak;
        blockedRescueWaves = next.blockedRescueWaves;
        checkpointStopPolicy();

        saveTree(runDir, tree);
        metrics.checkpoint({
          tree_stats: treeStats(tree),
          swarm_planner_rounds: tree.planner_rounds,
          parse_fail_streak: parseFailStreak,
          unproductive_streak: unproductiveStreak,
          blocked_rescue_waves: blockedRescueWaves,
          perfect_observe_streak: perfectObserveStreak,
          audit_converged_planner_rounds: auditConvergedPlannerRounds,
        });
      }
    }
  } finally {
    clearInterval(heartbeatTimer);
  }

  if (stopReason) {
    await drainInflightAfterStop(30_000);
  }

  abortLeftoverMerge(workspaceDir);
  ensureBuilt(workspaceDir);
  const result = finalizeRun({
    workspaceDir,
    runDir,
    metrics,
    tree,
    config,
    salvaged: false,
  });

  console.log(`[swarm] complete full=${(result.full.rate * 100).toFixed(1)}% visible=${(result.visible.rate * 100).toFixed(1)}% holdout=${(result.holdout.rate * 100).toFixed(1)}%`);
  console.log(`[swarm] planner_rounds=${tree.planner_rounds} reviews=${(metrics.data.reviews || []).length} metrics=${result.metricsPath}`);
}

main().catch((err) => {
  console.error("[swarm] fatal:", err);
  process.exit(1);
});
