#!/usr/bin/env node
/**
 * v13 Cursor-faithful swarm entry (S-A-008).
 * Planner tree + zero test signal + review stack + wall-clock budget.
 * Legacy test-driven pipeline remains in run.mjs / repair-engine.mjs.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig, projectRoot, resolveModel } from "./lib/config.mjs";
import {
  commitAll,
  commitCount,
  computeChurn,
  createWorktree,
  filesChangedInWorktree,
  readDesign,
  removeWorktree,
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
import { formatSpecToc } from "./lib/spec-toc.mjs";
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
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--mock") args.mock = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--run-id") args.runId = argv[++i];
    else if (a.startsWith("--run-id=")) args.runId = a.slice("--run-id=".length);
    else if (a === "--budget-minutes") args.budgetMinutes = Number(argv[++i]);
    else if (a.startsWith("--budget-minutes=")) args.budgetMinutes = Number(a.slice("--budget-minutes=".length));
    else if (a === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (a.startsWith("--concurrency=")) args.concurrency = Number(a.slice("--concurrency=".length));
  }
  return args;
}

function usage() {
  console.log(`Usage: node orchestrator/swarm.mjs [options]
  --run-id=ID
  --budget-minutes=N   Wall-clock budget (default config.swarm.budgetMinutes)
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

function runPool(items, concurrency, fn) {
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (idx < items.length) {
      const i = idx;
      idx += 1;
      await fn(items[i], i);
    }
  });
  return Promise.all(workers);
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
          deps: ["task-01"],
          files_scope: ["src/blocks/atx.ts", "src/blocks/registry.ts"],
          spec_sections: ["ATX headings"],
          notes: "Register ATX heading parser.",
        },
      ],
      rationale: "mock initial tree",
    };
  }
  // Second invite: no more work.
  return { actions: [{ type: "done" }], rationale: "mock done" };
}

function mockWorkerReport(task) {
  return {
    status: "done",
    summary: `mock completed ${task.id}`,
    oversized_files: [],
    guide_note: `mock note for ${task.id}`,
  };
}

function budgetRemainingMin(deadlineMs) {
  return Math.max(0, Math.ceil((deadlineMs - Date.now()) / 60000));
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
  deadlineMs,
}) {
  const swarm = config.swarm;
  if (mock) {
    const parsed = mockPlannerActions(tree, tree.planner_rounds);
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
    budgetRemainingMin: budgetRemainingMin(deadlineMs),
    maxTreeDepth: swarm.maxTreeDepth,
  });
  const result = await spawnAgent({
    role: "swarm-planner",
    prompt,
    cwd: workspaceDir,
    config,
    runDir,
    logKey: `swarm-planner-${tree.planner_rounds + 1}`,
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
  config,
  runDir,
  metrics,
  oversized,
  mock,
}) {
  const files = (oversized || []).map((o) => (typeof o === "string" ? o : `${o.file} (${o.lines} lines)`));
  if (mock) {
    metrics.recordAgentCall({ role: "splitter", ok: true, elapsedMs: 0, model: "mock" });
    return { status: "done", summary: "mock split skipped" };
  }
  const prompt = buildSplitterPrompt({
    oversizedFiles: files,
    designMd: readDesign(workspaceDir),
    oversizedLines: config.swarm.oversizedFileLines,
  });
  const result = await spawnAgent({
    role: "splitter",
    prompt,
    cwd: workspaceDir,
    config,
    runDir,
    logKey: `splitter-${Date.now()}`,
    timeoutMs: (config.taskTimeoutMinutes || 20) * 60 * 1000,
  });
  metrics.recordAgentCall({
    role: "splitter",
    ok: result.ok,
    ...agentUsage(result),
  });
  commitAll(workspaceDir, "split: oversized files");
  return extractJsonObject(result.output || "") || { status: result.ok ? "done" : "blocked" };
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
  deadlineMs,
}) {
  if (Date.now() >= deadlineMs) {
    return { task, ok: false, report: { status: "blocked", summary: "budget exhausted before dispatch" } };
  }

  const swarm = config.swarm;
  const started = Date.now();
  metrics.recordTask({ id: task.id, status: "in_progress", started_at: new Date().toISOString() });

  const wt = createWorktree(workspaceDir, worktreesRoot, task.id);
  const sections = task.spec_sections || [];
  const specText = sections.map((g) => getReferenceText(g, 20000)).filter(Boolean).join("\n\n")
    || "_No sections assigned — follow DESIGN.md._";

  let report;
  if (mock) {
    // Minimal mock edit so merge has something to do.
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
    };
  }

  // Local oversized self-report or scan.
  const changed = filesChangedInWorktree(wt.path);
  const localOver = findOversizedFiles(wt.path, changed, swarm.oversizedFileLines);
  if (localOver.length && report.status !== "oversized") {
    report.status = "oversized";
    report.oversized_files = localOver.map((o) => o.file);
  }

  // Faithful: record cross-scope changes, do not hard-fail.
  const violations = checkScopeViolation(changed, task.files_scope, { allowDesign: true });
  // guide/ is always allowed
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

  // Swarm always uses faithful coordination semantics.
  config.coordination = true;

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
    architecture: "v13-swarm",
  });

  console.log(`[swarm] id=${runId} mock=${cli.mock} budget=${config.swarm.budgetMinutes}m concurrency=${config.swarm.concurrency}`);
  console.log(`[swarm] planner=${resolveModel(config, "swarm-planner")} worker=${resolveModel(config, "worker")}`);

  initSwarmWorkspace(workspaceDir, { guideMaxLines: config.swarm.guideMaxLines });
  initSwarmSkeleton(workspaceDir, { mock: cli.mock });
  ensureHoldout(runDir, examplesPath(), config);

  const deadlineMs = Date.now() + config.swarm.budgetMinutes * 60 * 1000;
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

  let pendingFindings = [];
  let mergeSuccessCount = 0;
  let mergesSinceReview = 0;
  let lastWorkerReports = "_None yet._";
  const allFindings = [];

  // Main planner ↔ worker loop
  while (Date.now() < deadlineMs) {
    const plan = await invitePlanner({
      tree,
      workspaceDir,
      config,
      runDir,
      metrics,
      mock: cli.mock,
      workerReports: lastWorkerReports,
      reviewFindings: formatFindingsForPlanner(pendingFindings),
      deadlineMs,
    });
    tree.planner_rounds += 1;
    metrics.data.swarm_planner_rounds = tree.planner_rounds;

    if (plan.design_md && typeof plan.design_md === "string" && plan.design_md.trim()) {
      writeFileSync(path.join(workspaceDir, "DESIGN.md"), plan.design_md, "utf8");
      commitAll(workspaceDir, "planner: update DESIGN.md");
    }

    const actionResults = applyActions(tree, plan.actions || [], {
      maxTreeDepth: config.swarm.maxTreeDepth,
    });
    for (const r of actionResults) {
      if (!r.ok) console.warn(`[swarm] action failed: ${r.error}`);
    }
    saveTree(runDir, tree);
    pendingFindings = [];

    // One concurrent batch per planner round, then re-invite planner with reports
    // (S-A-008 tree delegation). If planner said done, drain remaining ready leaves.
    const drainMode = !!tree.done;
    let batchRan = false;
    while (Date.now() < deadlineMs) {
      const ready = readyLeaves(tree).filter((n) => (n.attempts || 0) < 3);
      if (!ready.length) break;

      const batch = ready.slice(0, config.swarm.concurrency);
      for (const leaf of batch) markLeaf(tree, leaf.id, "running");
      saveTree(runDir, tree);
      batchRan = true;

      const outcomes = [];
      await runPool(batch, config.swarm.concurrency, async (leaf) => {
        const out = await executeLeaf({
          task: leaf,
          workspaceDir,
          worktreesRoot,
          config,
          runDir,
          metrics,
          mergeQueue,
          mock: cli.mock,
          deadlineMs,
        });
        outcomes.push(out);
      });

      const reportLines = [];
      for (const out of outcomes) {
        if (out.ok) {
          markLeaf(tree, out.task.id, "done", out.report);
          mergeSuccessCount += 1;
          mergesSinceReview += 1;
        } else if (out.oversized) {
          markLeaf(tree, out.task.id, "blocked", out.report);
          const split = await runSplitter({
            workspaceDir,
            config,
            runDir,
            metrics,
            oversized: out.report?.oversized_files || out.mergeResult?.oversized_files || [],
            mock: cli.mock,
          });
          metrics.data.splits = metrics.data.splits || [];
          metrics.data.splits.push({
            taskId: out.task.id,
            at: new Date().toISOString(),
            result: split,
          });
          markLeaf(tree, out.task.id, "pending", out.report);
        } else {
          markLeaf(tree, out.task.id, "blocked", out.report);
        }
        reportLines.push(
          `- ${out.task.id}: ${out.report?.status || (out.ok ? "done" : "failed")} — ${String(out.report?.summary || "").slice(0, 200)}`,
        );
      }
      lastWorkerReports = reportLines.join("\n") || "_None._";
      saveTree(runDir, tree);

      if (
        config.swarm.observeScoreEveryMerges > 0
        && mergeSuccessCount > 0
        && mergeSuccessCount % config.swarm.observeScoreEveryMerges === 0
      ) {
        observeScore({
          workspaceDir,
          runDir,
          metrics,
          label: `m${mergeSuccessCount}`,
        });
      }

      if (
        config.swarm.reviewEveryNMerges > 0
        && mergesSinceReview >= config.swarm.reviewEveryNMerges
      ) {
        mergesSinceReview = 0;
        if (!cli.mock) {
          console.log(`[swarm] review stack after ${mergeSuccessCount} merges`);
          const stack = await runReviewStack({
            workspaceDir,
            config,
            runDir,
            metrics,
            perspectives: config.swarm.reviewPerspectives,
          });
          pendingFindings = stack.findings;
          allFindings.push(...stack.findings);
          metrics.data.reviews = metrics.data.reviews || [];
          metrics.data.reviews.push({
            at: new Date().toISOString(),
            after_merges: mergeSuccessCount,
            findings: stack.findings,
          });
        } else {
          pendingFindings = [{ severity: "low", perspective: "mock", summary: "mock review finding" }];
          metrics.data.reviews = metrics.data.reviews || [];
          metrics.data.reviews.push({
            at: new Date().toISOString(),
            after_merges: mergeSuccessCount,
            findings: pendingFindings,
          });
        }
      }

      // Normal mode: one batch then return to planner. Drain mode: keep going.
      if (!drainMode) break;
    }

    if (tree.done && !readyLeaves(tree).filter((n) => (n.attempts || 0) < 3).length) {
      console.log("[swarm] planner declared done");
      break;
    }

    if (!batchRan && !tree.done) {
      const stats = treeStats(tree);
      if (stats.pending === 0 && stats.running === 0) {
        if (!(plan.actions || []).some((a) => ["add_task", "split_task", "requeue_task", "add_plan_node"].includes(a.type))) {
          console.log("[swarm] idle tree and no productive planner actions; stopping");
          break;
        }
      }
    }
  }

  if (Date.now() >= deadlineMs) {
    console.log("[swarm] wall-clock budget exhausted");
  }

  // Final observation scores (still hidden from agents — agents are done).
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
