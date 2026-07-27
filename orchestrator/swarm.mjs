#!/usr/bin/env node
/**
 * v13.1 Cursor-faithful swarm entry (S-A-008).
 * Event-driven planner/worker pipeline + run-to-done + zero test signal.
 * Legacy test-driven pipeline remains in run.mjs / repair-engine.mjs.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig, projectRoot, resolveModel } from "./lib/config.mjs";
import {
  abortMerge,
  commitAll,
  commitCount,
  computeChurn,
  createWorktree,
  filesChangedInWorktree,
  readDesign,
  removeWorktree,
  syncWorktreeWithMain,
} from "./lib/git.mjs";
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
  applyActions,
  createEmptyTree,
  formatTreeForPlanner,
  markLeaf,
  readyLeaves,
  saveTree,
  treeStats,
} from "./lib/tree.mjs";
import {
  examplesPath,
  getReferenceText,
  loadExamples,
  scanForOracleLiterals,
  scoreScope,
} from "./lib/verifier.mjs";
import { initSwarmSkeleton, initSwarmWorkspace } from "./lib/workspace.mjs";
import { MergeQueue, checkScopeViolation, findOversizedFiles } from "./merge-queue.mjs";
import { countLoc, createMetricsCollector } from "./metrics.mjs";
import { agentUsage, spawnAgent } from "./runner.mjs";

function parseArgs(argv) {
  const args = {
    mock: false,
    runId: null,
    budgetMinutes: null,
    concurrency: null,
    runToDone: false,
    maxWallMinutes: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--mock") args.mock = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--run-to-done") args.runToDone = true;
    else if (a === "--run-id") args.runId = argv[++i];
    else if (a.startsWith("--run-id=")) args.runId = a.slice("--run-id=".length);
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
  --budget-minutes=N   Wall-clock budget when not --run-to-done (default config.swarm.budgetMinutes)
  --run-to-done        Run until planner declares done (hard stop: maxWallMinutes)
  --max-wall-minutes=N Hard safety stop for --run-to-done (default config.swarm.maxWallMinutes)
  --concurrency=N
  --mock               Scripted planner/worker; no LLM
  --help`);
}

function ensureBuilt(workspaceDir) {
  try {
    if (!existsSync(path.join(workspaceDir, "node_modules"))) {
      execSync("npm install", { cwd: workspaceDir, stdio: "ignore", shell: true });
    }
    execSync("npm run build", { cwd: workspaceDir, encoding: "utf8", shell: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, stderr: String(err.stderr || err.stdout || err.message || "") };
  }
}

async function ensureBuiltWithRepair({ workspaceDir, config, runDir, metrics, taskId }) {
  const max = config.maxIntegrationFixRetries ?? 2;
  for (let attempt = 1; attempt <= max + 1; attempt += 1) {
    const build = ensureBuilt(workspaceDir);
    if (build.ok) return { ok: true, attempts: attempt - 1 };
    if (attempt > max) return { ok: false, stderr: build.stderr, attempts: attempt - 1 };
    const prompt = [
      "The TypeScript build failed after a merge/integration.",
      "Fix compile errors with the smallest change. Update DESIGN.md / contracts.ts if interfaces changed.",
      "Do not look for external test oracles.",
      "",
      "Build error:",
      "```",
      (build.stderr || "").slice(0, 4000),
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
    metrics.recordIntegrationFix?.({ taskId, attempt, ok: result.ok });
  }
  return { ok: false };
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
    // planner_rounds is incremented before invite; round 0 = first invite
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
  const parsed = extractJsonObject(result.output || "");
  if (!parsed) {
    console.warn("[swarm] planner JSON parse failed");
    return { actions: [], rationale: "parse_failed" };
  }
  return parsed;
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

  if (report.guide_note) appendGuideNote(wt.path, report.guide_note);

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

  const mergeResult = await mergeQueue.enqueue({
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
  const workspaceDir = path.join(runDir, "workspace");
  const worktreesRoot = path.join(runDir, "worktrees");
  mkdirSync(runDir, { recursive: true });

  const metrics = createMetricsCollector(runDir);
  metrics.setMeta({
    coordination: true,
    coordination_mode: "faithful-swarm",
    planner_source: cli.mock ? "mock-swarm" : "swarm-planner",
    task_set: "swarm-tree",
    swarm: true,
    architecture: "v13.1-swarm",
    run_to_done: !!swarm.runToDone,
  });

  const startedAtMs = Date.now();
  const hardDeadlineMs = startedAtMs + (swarm.runToDone ? swarm.maxWallMinutes : swarm.budgetMinutes) * 60 * 1000;

  console.log(
    `[swarm] id=${runId} mock=${cli.mock} runToDone=${swarm.runToDone}`
      + ` hardStop=${swarm.runToDone ? swarm.maxWallMinutes : swarm.budgetMinutes}m`
      + ` concurrency=${swarm.concurrency}`,
  );
  console.log(`[swarm] planner=${resolveModel(config, "swarm-planner")} worker=${resolveModel(config, "worker")}`);

  initSwarmWorkspace(workspaceDir, { guideMaxLines: swarm.guideMaxLines });
  initSwarmSkeleton(workspaceDir, { mock: cli.mock });
  ensureHoldout(runDir, examplesPath(), config);

  let tree = createEmptyTree();
  saveTree(runDir, tree);

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
  let mergeSuccessCount = 0;
  let mergesSinceReview = 0;
  let sinceObserve = 0;
  let idlePlannerRounds = 0;
  let reviewInFlight = false;
  let observeInFlight = false;
  /** @type {Map<string, any>} */
  const leafResults = new Map();
  let plannerResult = null;
  let plannerSettled = false;

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
      console.log("[swarm] planner declared done");
      break;
    }
    if (pastDeadline && running.size === 0 && auxJobs.size === 0 && !plannerPromise) {
      console.log("[swarm] wall-clock budget exhausted");
      break;
    }
    if (idlePlannerRounds >= 2) {
      console.log("[swarm] idle tree and no productive planner actions; stopping");
      break;
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
          observeScore({ workspaceDir, runDir, metrics, label });
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
    }

    if (plannerSettled && plannerPromise) {
      const plan = plannerResult || { actions: [] };
      plannerPromise = null;
      plannerSettled = false;
      plannerResult = null;

      if (plan.design_md && typeof plan.design_md === "string" && plan.design_md.trim()) {
        await mergeQueue.enqueueFn(() => {
          writeFileSync(path.join(workspaceDir, "DESIGN.md"), plan.design_md, "utf8");
          commitAll(workspaceDir, "planner: update DESIGN.md");
        }, "design-update");
      }

      const actions = Array.isArray(plan.actions) ? [...plan.actions] : [];

      // Apply non-done actions first so same-batch waive_section counts for the done gate.
      const doneActions = actions.filter((a) => a?.type === "done");
      const preDoneActions = actions.filter((a) => a?.type !== "done");
      const readyBefore = readyNow().length;
      const preResults = applyActions(tree, preDoneActions, {
        maxTreeDepth: swarm.maxTreeDepth,
      });
      for (const r of preResults) {
        if (!r.ok) {
          console.warn(`[swarm] action failed: ${r.error}`);
          actionErrors.push(r.error);
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
      saveTree(runDir, tree);

      const readyAfter = readyNow().length;
      const productive = preDoneActions.some((a) => [
        "add_task", "split_task", "requeue_task", "add_plan_node", "waive_section",
      ].includes(a?.type)) || tree.done;
      const stalledAfter = running.size === 0 && readyAfter === 0 && !tree.done;
      if (stalledAfter && !productive) {
        idlePlannerRounds += 1;
      } else if (readyAfter > readyBefore || productive || tree.done) {
        idlePlannerRounds = 0;
      }
    }
  }

  ensureBuilt(workspaceDir);
  const visible = scoreScope(workspaceDir, path.join(runDir, "score-visible.json"), {
    holdoutFile: holdoutFilePath(runDir),
    holdoutMode: "exclude",
  });
  const holdout = scoreScope(workspaceDir, path.join(runDir, "score-holdout.json"), {
    holdoutFile: holdoutFilePath(runDir),
    holdoutMode: "only",
  });
  const full = scoreScope(workspaceDir, path.join(runDir, "score-full.json"), {});
  metrics.recordScore({ phase: "final-visible", ...visible.report });
  metrics.recordScore({ phase: "final-holdout", ...holdout.report });
  metrics.recordScore({ phase: "final-full", ...full.report });

  const examples = loadExamples();
  const oracleHits = scanForOracleLiterals(workspaceDir, examples);
  const gapPp = visible.report.rate != null && holdout.report.rate != null
    ? Number(((visible.report.rate - holdout.report.rate) * 100).toFixed(1))
    : null;

  metrics.data.tree_stats = treeStats(tree);
  metrics.data.reviews = metrics.data.reviews || [];
  metrics.data.splits = metrics.data.splits || [];
  metrics.data.oversized_blocks = metrics.data.oversized_blocks || [];
  metrics.data.swarm_planner_rounds = tree.planner_rounds;
  saveTree(runDir, tree);

  const metricsPath = metrics.finish({
    final_score: full.report,
    visible_score: visible.report,
    holdout_score: holdout.report,
    holdout_gap_pp: gapPp,
    overfit_alarm: gapPp != null && gapPp >= (config.holdout.alarmPp ?? 5),
    oracle_literal_hits: oracleHits,
    commits: commitCount(workspaceDir),
    loc: countLoc(workspaceDir),
    churn: computeChurn(workspaceDir),
    tree_stats: treeStats(tree),
    swarm_planner_rounds: tree.planner_rounds,
  });

  console.log(`[swarm] complete full=${(full.report.rate * 100).toFixed(1)}% visible=${(visible.report.rate * 100).toFixed(1)}% holdout=${(holdout.report.rate * 100).toFixed(1)}%`);
  console.log(`[swarm] planner_rounds=${tree.planner_rounds} reviews=${(metrics.data.reviews || []).length} metrics=${metricsPath}`);
}

main().catch((err) => {
  console.error("[swarm] fatal:", err);
  process.exit(1);
});
