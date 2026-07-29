#!/usr/bin/env node
/**
 * v13.3 Cursor-faithful swarm entry (S-A-008).
 * Event-driven planner/worker pipeline + run-to-done + zero test signal
 * + detach / heartbeat / checkpoint / resume
 * + serial Field Guide notes / CLI canary / planner ID remap.
 * Legacy test-driven pipeline remains in run.mjs / repair-engine.mjs.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, projectRoot, resolveModel } from "./lib/config.mjs";
import { finalizeRun } from "./lib/finalize.mjs";
import {
  abortMerge,
  cleanupInterruptedRun,
  commitAll,
  createWorktree,
  filesChangedInWorktree,
  readDesign,
  removeWorktree,
  syncWorktreeWithMain,
} from "./lib/git.mjs";
import { npmExec, powershellCommand, taskkillPid } from "./lib/win-exec.mjs";
import { appendGuideNote, readGuideIndex } from "./lib/guide.mjs";
import { ensureHoldout, holdoutFilePath } from "./lib/holdout.mjs";
import { extractJsonObject } from "./lib/json-parse.mjs";
import {
  buildSplitterPrompt,
  buildSwarmPlannerPrompt,
  buildSwarmWorkerPrompt,
} from "./lib/prompts.mjs";
import { formatFindingsForPlanner, runReviewStack } from "./lib/review-stack.mjs";
import { formatSpecToc, listSpecSections } from "./lib/spec-toc.mjs";
import {
  appliedActionsAreProductive,
  nextStreaks,
  shouldStop,
  stopConsoleMessage,
} from "./lib/swarm-stop-policy.mjs";
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
import { initSwarmSkeleton, initSwarmWorkspace } from "./lib/workspace.mjs";
import { MergeQueue, checkScopeViolation, findOversizedFiles } from "./merge-queue.mjs";
import {
  activeWallMinutes,
  createMetricsCollector,
  loadMetricsSeed,
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
    detach: false,
    resume: false,
    task: "commonmark",
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
  --concurrency=N
  --detach             Respawn as a detached process (console.log + swarm.pid); exit parent
  --resume             Resume an interrupted run (requires --run-id)
  --mock               Scripted planner/worker; no LLM
  --help`);
}

function ensureBuilt(workspaceDir) {
  try {
    if (!existsSync(path.join(workspaceDir, "node_modules"))) {
      npmExec(["install"], { cwd: workspaceDir, stdio: "ignore" });
    }
    npmExec(["run", "build"], { cwd: workspaceDir, encoding: "utf8" });
    return { ok: true };
  } catch (err) {
    return { ok: false, stderr: String(err.stderr || err.stdout || err.message || "") };
  }
}

/** Runtime smoke: CLI must accept pack canary stdin with exit 0. No suite oracle. */
function runCliCanary(workspaceDir) {
  const pack = getActiveTaskPack();
  const cli = path.join(workspaceDir, "dist", "cli.js");
  if (!existsSync(cli)) {
    return { ok: false, stderr: `Missing ${cli}` };
  }
  const result = spawnSync(process.execPath, [cli], {
    cwd: workspaceDir,
    input: pack.canaryInput || "canary\n",
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) {
    return { ok: false, stderr: String(result.error.message || result.error) };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      stderr: String(result.stderr || result.stdout || `cli exit ${result.status}`).trim(),
    };
  }
  return { ok: true };
}

async function ensureBuiltWithRepair({ workspaceDir, config, runDir, metrics, taskId }) {
  const max = config.maxIntegrationFixRetries ?? 2;
  for (let attempt = 1; attempt <= max + 1; attempt += 1) {
    const build = ensureBuilt(workspaceDir);
    let failureKind = null;
    let failureText = "";
    if (!build.ok) {
      failureKind = "build";
      failureText = build.stderr || "";
    } else {
      const canary = runCliCanary(workspaceDir);
      if (canary.ok) return { ok: true, attempts: attempt - 1 };
      failureKind = "canary";
      failureText = canary.stderr || "";
    }
    if (attempt > max) {
      return { ok: false, stderr: failureText, attempts: attempt - 1, canary: failureKind === "canary" };
    }
    const prompt = failureKind === "canary"
      ? [
        "After a merge/integration, `node dist/cli.js` crashes on startup (or exits non-zero) when fed a trivial stdin line.",
        "Fix the runtime import/init error with the smallest change. Update DESIGN.md / contracts.ts if interfaces changed.",
        "Do not look for external test oracles. Do not add import-time assertions that throw on module load.",
        "",
        "Runtime error:",
        "```",
        failureText.slice(0, 4000),
        "```",
        "",
        "Say INTEGRATION_FIXED when done.",
      ].join("\n")
      : [
        "The TypeScript build failed after a merge/integration.",
        "Fix compile errors with the smallest change. Update DESIGN.md / contracts.ts if interfaces changed.",
        "Do not look for external test oracles.",
        "",
        "Build error:",
        "```",
        failureText.slice(0, 4000),
        "```",
        "",
        "Say INTEGRATION_FIXED when done.",
      ].join("\n");
    const result = await spawnAgent({
      role: "integration-fix",
      prompt,
      cwd: workspaceDir,
      config,
      runDir,
      logKey: `swarm-integration-${taskId}-${attempt}`,
      timeoutMs: (config.taskTimeoutMinutes || 20) * 60 * 1000,
    });
    metrics.recordAgentCall({
      role: "integration-fix",
      taskId,
      attempt,
      ok: result.ok,
      ...agentUsage(result),
    });
    metrics.recordIntegrationFix?.({ taskId, attempt, ok: result.ok, kind: failureKind });
  }
  return { ok: false };
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
  const done = new Set();
  for (const n of Object.values(tree.nodes || {})) {
    if (n.kind === "leaf" && n.status === "done") {
      for (const s of n.spec_sections || []) done.add(s);
    }
  }
  const waived = new Set(tree.waived_sections || []);
  return listSpecSections().filter((s) => !done.has(s) && !waived.has(s));
}

function formatCoverage(tree) {
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
  return lines.join("\n");
}

function formatBudgetLine(swarm, startedAtMs, hardDeadlineMs) {
  const elapsedMin = Math.max(0, Math.floor((Date.now() - startedAtMs) / 60000));
  if (swarm.runToDone) {
    const hardMin = Math.max(0, Math.ceil((hardDeadlineMs - startedAtMs) / 60000));
    return `No fixed deadline. Elapsed: ${elapsedMin} min. Hard safety stop at ${hardMin} min.`;
  }
  const remaining = Math.max(0, Math.ceil((hardDeadlineMs - Date.now()) / 60000));
  return `Wall-clock remaining: ${remaining} minutes.`;
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
  const actions = uncoveredSections(tree).map((section) => ({
    type: "waive_section",
    section,
    reason: "mock waive",
  }));
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
  fanoutTarget,
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
    fanoutTarget,
    maxTreeDepth: swarm.maxTreeDepth,
  });
  const result = await spawnAgent({
    role: "swarm-planner",
    prompt,
    cwd: workspaceDir,
    config,
    runDir,
    logKey: `swarm-planner-${logRound}`,
    timeoutMs: (config.taskTimeoutMinutes || 20) * 60 * 1000,
  });
  metrics.recordAgentCall({
    role: "swarm-planner",
    ok: result.ok,
    ...agentUsage(result),
  });
  let parsed = extractJsonObject(result.output || "");
  if (parsed) return parsed;

  // One cheap JSON-repair retry (role falls back to worker model).
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
    cwd: workspaceDir,
    config,
    runDir,
    logKey: `swarm-planner-${logRound}-json-repair`,
    timeoutMs: Math.min((config.taskTimeoutMinutes || 20) * 60 * 1000, 5 * 60 * 1000),
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

function harnessRequeueBlocked(tree, limit) {
  const ids = blockedLeafIds(tree).slice(0, Math.max(0, limit));
  if (!ids.length) return [];
  const actions = ids.map((id) => ({ type: "requeue_task", id }));
  applyActions(tree, actions);
  return ids;
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
    await mergeQueue.enqueue({
      branch: wt.branch,
      taskId: splitId,
      afterMerge: () => ensureBuiltWithRepair({
        workspaceDir,
        config,
        runDir,
        metrics,
        taskId: splitId,
      }),
    });
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
    return { task, ok: false, report, oversized: report.status === "oversized" };
  }

  const sync = syncWorktreeWithMain(wt.path);
  if (sync.conflict) abortMerge(wt.path);
  metrics.recordWorktreeSync({ taskId: task.id, conflict: !!sync.conflict });

  let mergeResult;
  try {
    mergeResult = await mergeQueue.enqueue({
      branch: wt.branch,
      taskId: task.id,
      afterMerge: () => ensureBuiltWithRepair({
        workspaceDir,
        config,
        runDir,
        metrics,
        taskId: task.id,
      }),
    });
  } catch (err) {
    removeWorktree(workspaceDir, wt.path);
    const failedReport = {
      ...report,
      status: "blocked",
      summary: `merge exception: ${err?.message || err}`,
    };
    metrics.recordTask({
      id: task.id,
      status: "failed",
      elapsedMs: Date.now() - started,
      report: failedReport,
    });
    return { task, ok: false, report: failedReport };
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

  const ok = mergeResult.ok && mergeResult.postMerge?.ok !== false;
  if (ok && report.guide_note) {
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
    status: ok ? "done" : "failed",
    elapsedMs: Date.now() - started,
    report,
    merge: { ok: mergeResult.ok, oversized: !!mergeResult.oversized },
  });
  return { task, ok, report, mergeResult };
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

  const config = loadConfig();
  if (cli.concurrency != null && !Number.isNaN(cli.concurrency)) {
    config.swarm.concurrency = cli.concurrency;
    config.concurrency = cli.concurrency;
  }
  if (cli.budgetMinutes != null && !Number.isNaN(cli.budgetMinutes)) {
    config.swarm.budgetMinutes = cli.budgetMinutes;
  }
  if (cli.runToDone) config.swarm.runToDone = true;
  if (cli.maxWallMinutes != null && !Number.isNaN(cli.maxWallMinutes)) {
    config.swarm.maxWallMinutes = cli.maxWallMinutes;
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
    initSwarmWorkspace(workspaceDir, { guideMaxLines: swarm.guideMaxLines });
    initSwarmSkeleton(workspaceDir, { mock: cli.mock, skeleton: taskPack.skeleton });
    ensureHoldout(runDir, examplesPath(), config);
    tree = createEmptyTree();
    saveTree(runDir, tree);
  }

  metrics.setMeta({
    coordination: true,
    coordination_mode: "faithful-swarm",
    planner_source: cli.mock ? "mock-swarm" : "swarm-planner",
    task_set: "swarm-tree",
    task_pack: taskPack.id,
    swarm: true,
    architecture: "v13.3-swarm",
    run_to_done: !!swarm.runToDone,
    resumed: !!cli.resume,
  });

  console.log(
    `[swarm] id=${runId} task=${taskPack.id} mock=${cli.mock} resume=${cli.resume} runToDone=${swarm.runToDone}`
      + ` hardStop=${swarm.runToDone ? swarm.maxWallMinutes : swarm.budgetMinutes}m`
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
  let sinceObserve = 0;
  let parseFailStreak = 0;
  let unproductiveStreak = 0;
  let blockedRescueWaves = 0;
  let stopReason = null;
  let reviewInFlight = false;
  let observeInFlight = false;
  /** @type {Map<string, any>} */
  const leafResults = new Map();
  let plannerResult = null;
  let plannerSettled = false;
  /** Snapshots to restore if planner returns null. */
  let plannerSnap = null;

  function checkpointStopPolicy() {
    metrics.data.parse_fail_streak = parseFailStreak;
    metrics.data.unproductive_streak = unproductiveStreak;
    metrics.data.blocked_rescue_waves = blockedRescueWaves;
    if (stopReason) metrics.data.stop_reason = stopReason;
  }

  function requestStop(reason) {
    stopReason = reason;
    metrics.data.stop_reason = reason;
    checkpointStopPolicy();
    console.log(stopConsoleMessage(reason));
    const resetN = resetRunningLeaves(tree);
    if (resetN) {
      console.log(`[swarm] reset ${resetN} in-flight leaves → pending before stop`);
      saveTree(runDir, tree);
    }
  }

  async function drainInflightAfterStop(graceMs = 30000) {
    const pending = [...running.values(), plannerPromise, ...auxJobs].filter(Boolean);
    if (!pending.length) return;
    console.log(`[swarm] draining ${pending.length} in-flight jobs (grace ${graceMs}ms)`);
    let timedOut = false;
    await Promise.race([
      Promise.allSettled(pending),
      new Promise((resolve) => {
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, graceMs);
      }),
    ]);
    if (timedOut) console.warn("[swarm] drain grace elapsed; continuing finalize");
    // Drop late results without applying — tree already reset for stop.
    leafResults.clear();
    running.clear();
    plannerPromise = null;
    plannerSettled = false;
    plannerResult = null;
    // Re-assert pending for any leaf still marked running after late writes.
    const resetN = resetRunningLeaves(tree);
    if (resetN) saveTree(runDir, tree);
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
      const readyNow = () => readyLeaves(tree).filter((n) => (n.attempts || 0) < swarm.maxLeafAttempts);

      if (
        tree.done
        && running.size === 0
        && auxJobs.size === 0
        && !plannerPromise
        && readyNow().length === 0
      ) {
        requestStop("planner_done");
        break;
      }
      if (pastDeadline && running.size === 0 && auxJobs.size === 0 && !plannerPromise) {
        requestStop("wall_budget");
        break;
      }
      {
        const stop = shouldStop({
          parseFailStreak,
          unproductiveStreak,
          maxPlannerParseFails: swarm.maxPlannerParseFails,
          maxUnproductivePlannerRounds: swarm.maxUnproductivePlannerRounds,
        });
        if (stop.stop) {
          requestStop(stop.reason);
          break;
        }
      }

      if (!pastDeadline) {
        while (running.size < swarm.concurrency) {
          const candidates = readyNow().filter((n) => !running.has(n.id));
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
          }).then((out) => {
            leafResults.set(leaf.id, out);
            return { kind: "leaf", taskId: leaf.id };
          });
          running.set(leaf.id, p);
        }
      }

      const treeEmpty = Object.keys(tree.nodes).length === 0;
      const stalled = running.size === 0 && readyNow().length === 0;
      const shouldInvitePlanner = !plannerPromise
        && !tree.done
        && !pastDeadline
        && (treeEmpty || pendingReports.length >= swarm.plannerReportBatch || stalled);

      if (shouldInvitePlanner) {
        const reportsSnap = pendingReports.splice(0);
        const findingsSnap = pendingFindings.splice(0);
        const errorsSnap = actionErrors.splice(0);
        plannerSnap = { reportsSnap, findingsSnap, errorsSnap };
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
          coverage: formatCoverage(tree),
          budgetLine: formatBudgetLine(swarm, startedAtMs, hardDeadlineMs),
          fanoutTarget: swarm.concurrency * 2,
          logRound,
        }).then((plan) => {
          plannerResult = plan;
          plannerSettled = true;
          return { kind: "planner" };
        });
      }

      if (
        !pastDeadline
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
              metrics.data.reviews = metrics.data.reviews || [];
              metrics.data.reviews.push({
                at: new Date().toISOString(),
                after_merges: afterMerges,
                findings,
              });
              return { kind: "review" };
            }
            console.log(`[swarm] review stack after ${afterMerges} merges`);
            const snapId = `review-${afterMerges}`;
            const wt = createWorktree(workspaceDir, worktreesRoot, snapId);
            try {
              const stack = await runReviewStack({
                workspaceDir: wt.path,
                config,
                runDir,
                metrics,
                perspectives: swarm.reviewPerspectives,
              });
              pendingFindings.push(...stack.findings);
              metrics.data.reviews = metrics.data.reviews || [];
              metrics.data.reviews.push({
                at: new Date().toISOString(),
                after_merges: afterMerges,
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
        !pastDeadline
        && !observeInFlight
        && swarm.observeScoreEveryMerges > 0
        && sinceObserve >= swarm.observeScoreEveryMerges
      ) {
        sinceObserve = 0;
        observeInFlight = true;
        const label = `m${mergeSuccessCount}`;
        const obsJob = (async () => {
          try {
            const report = observeScore({ workspaceDir, runDir, metrics, label });
            if (report && report.total > 0 && report.passed === 0) {
              const canary = runCliCanary(workspaceDir);
              const hint = (canary.stderr || "cli canary failed").split("\n")[0].slice(0, 160);
              console.warn(`[swarm] observe redline: zero passes (m${mergeSuccessCount}); canary=${canary.ok}`);
              actionErrors.push(
                `URGENT: main workspace CLI appears broken (observe all-fail). `
                  + `Schedule a fix task immediately. Hint: ${hint}`,
              );
            }
            return { kind: "observe" };
          } finally {
            observeInFlight = false;
          }
        })();
        trackPromise(auxJobs, obsJob);
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
          markLeaf(tree, out.task.id, "done", report);
          mergeSuccessCount += 1;
          mergesSinceReview += 1;
          sinceObserve += 1;
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
        plannerSnap = null;

        if (plan.design_md && typeof plan.design_md === "string" && plan.design_md.trim()) {
          await mergeQueue.enqueueFn(() => {
            writeFileSync(path.join(workspaceDir, "DESIGN.md"), plan.design_md, "utf8");
            commitAll(workspaceDir, "planner: update DESIGN.md");
          }, "design-update");
        }

        const actions = Array.isArray(plan.actions) ? [...plan.actions] : [];

        const doneActions = actions.filter((a) => a?.type === "done");
        const preDoneActions = actions.filter((a) => a?.type !== "done");
        const preResults = applyActions(tree, preDoneActions, {
          maxTreeDepth: swarm.maxTreeDepth,
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
            const doneResults = applyActions(tree, doneActions, {
              maxTreeDepth: swarm.maxTreeDepth,
            });
            for (const r of doneResults) {
              if (!r.ok) {
                console.warn(`[swarm] action failed: ${r.error}`);
                actionErrors.push(r.error);
              }
            }
          }
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
          const requeued = harnessRequeueBlocked(tree, swarm.concurrency);
          actionErrors.push(`harness requeued blocked: ${requeued.join(", ") || "(none)"}`);
          console.log(`[swarm] harness rescue wave ${next.blockedRescueWaves}: requeued ${requeued.length} blocked leaves`);
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
