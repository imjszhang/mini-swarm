#!/usr/bin/env node
/**
 * mini-swarm orchestrator: planner → workers → merge → score.
 */
import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { loadConfig, projectRoot } from "./lib/config.mjs";
import {
  abortMerge,
  commitCount,
  createWorktree,
  filesChangedInWorktree,
  getDiff,
  initRepo,
  readDesign,
  readGuide,
  removeWorktree,
} from "./lib/git.mjs";
import {
  buildPlannerPrompt,
  buildReviewerPrompt,
  buildWorkerPrompt,
} from "./lib/prompts.mjs";
import { runScore } from "./lib/score-run.mjs";
import {
  loadTasks,
  saveTasks,
  seedTasks,
  sectionSummary,
  validateDisjointScopes,
} from "./lib/tasks.mjs";
import { checkScopeViolation, MergeQueue } from "./merge-queue.mjs";
import { countLoc, createMetricsCollector } from "./metrics.mjs";
import { spawnAgent } from "./runner.mjs";

const ROOT = projectRoot();

function ensureBuilt(workspaceDir) {
  if (!existsSync(path.join(workspaceDir, "package.json"))) return;
  try {
    execSync("npm install", { cwd: workspaceDir, stdio: "ignore", shell: true });
    execSync("npm run build", { cwd: workspaceDir, stdio: "ignore", shell: true });
  } catch (err) {
    console.warn(`[run] build failed in ${workspaceDir}: ${err.message || err}`);
  }
}

function parseArgs(argv) {
  const args = {
    coordination: false,
    quick: false,
    serial: false,
    mock: false,
    runId: null,
    concurrency: null,
    help: false,
  };
  for (const a of argv) {
    if (a === "--coordination") args.coordination = true;
    else if (a === "--quick") args.quick = true;
    else if (a === "--serial") args.serial = true;
    else if (a === "--mock") args.mock = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a.startsWith("--run-id=")) args.runId = a.split("=")[1];
    else if (a.startsWith("--concurrency=")) args.concurrency = Number(a.split("=")[1]);
  }
  return args;
}

function usage() {
  console.log(`Usage: node orchestrator/run.mjs [options]

Options:
  --coordination     Run B: disjoint scopes, DESIGN.md, GUIDE.md, neutral merger
  --quick            Only first 3 tasks (cheaper experiment)
  --serial           Concurrency 1, no worktrees (minimal loop)
  --mock             Skip LLM agents; seed tasks + stub workspace only
  --run-id=ID        Custom run id (default: timestamp)
  --concurrency=N    Override config concurrency
`);
}

async function runPlanner({ workspaceDir, config, runDir, coordination, metrics }) {
  const examplesPath = path.join(ROOT, "spec", "examples.json");
  const sections = sectionSummary();
  const prompt = `${buildPlannerPrompt({ coordination })}

## Spec sections (example counts)

${JSON.stringify(sections, null, 2)}

Examples file path: ${examplesPath}

Write tasks.json in the workspace root. If coordination is on, also write DESIGN.md and GUIDE.md.
`;

  if (config.mock) {
    seedTasks(workspaceDir);
    if (coordination) {
      writeFileSync(path.join(workspaceDir, "DESIGN.md"), "# Design\n\nModule-per-section parser pipeline.\n", "utf8");
      writeFileSync(path.join(workspaceDir, "GUIDE.md"), "# Field Guide\n\n", "utf8");
    }
    return loadTasks(workspaceDir);
  }

  const result = await spawnAgent({
    role: "planner",
    prompt,
    cwd: workspaceDir,
    config,
    runDir,
    logKey: "planner",
    timeoutMs: (config.taskTimeoutMinutes || 20) * 60 * 1000,
  });
  metrics.recordAgentCall({
    role: "planner",
    ok: result.ok,
    elapsedMs: result.elapsedMs,
  });

  let tasks = loadTasks(workspaceDir);
  if (!tasks?.length) {
    console.warn("[run] planner did not produce tasks.json; using seed tasks");
    tasks = seedTasks(workspaceDir);
  }
  return tasks;
}

async function runWorkerTask({
  task,
  cwd,
  config,
  runDir,
  coordination,
  metrics,
}) {
  const designMd = readDesign(cwd);
  const guideMd = readGuide(cwd);
  const prompt = buildWorkerPrompt({ task, designMd, guideMd });
  const result = await spawnAgent({
    role: "worker",
    prompt,
    cwd,
    config,
    runDir,
    logKey: `worker-${task.id}`,
    timeoutMs: (config.taskTimeoutMinutes || 20) * 60 * 1000,
  });
  metrics.recordAgentCall({
    role: "worker",
    taskId: task.id,
    ok: result.ok,
    elapsedMs: result.elapsedMs,
  });
  return result;
}

async function runPool(items, concurrency, fn) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx;
      idx += 1;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function initWorkspace(workspaceDir, coordination) {
  rmSync(workspaceDir, { recursive: true, force: true });
  mkdirSync(workspaceDir, { recursive: true });
  initRepo(workspaceDir);
  if (coordination) {
    writeFileSync(path.join(workspaceDir, "GUIDE.md"), "# Field Guide\n\nTips for workers.\n", "utf8");
    writeFileSync(path.join(workspaceDir, "DESIGN.md"), "# Design\n\n(Planner will expand this.)\n", "utf8");
  }
  writeFileSync(path.join(workspaceDir, ".gitignore"), "node_modules/\ndist/\n", "utf8");
}

function initSkeleton(workspaceDir) {
  mkdirSync(path.join(workspaceDir, "src"), { recursive: true });
  const pkg = {
    name: "mini-commonmark",
    type: "module",
    scripts: { build: "tsc" },
    devDependencies: { typescript: "^5.6.0", "@types/node": "^22.0.0" },
  };
  writeFileSync(path.join(workspaceDir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  writeFileSync(path.join(workspaceDir, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      outDir: "dist",
      rootDir: "src",
      strict: true,
    },
    include: ["src/**/*"],
  }, null, 2)}\n`, "utf8");
  writeFileSync(path.join(workspaceDir, "src", "cli.ts"), `import { renderMarkdown } from "./index.js";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", () => { process.stdout.write(renderMarkdown(input)); });
`);
  writeFileSync(path.join(workspaceDir, "src", "index.ts"), `export function renderMarkdown(input: string): string {
  return input.trim() ? "<p>" + input.trim() + "</p>\\n" : "";
}
`);
  try {
    execSync("git add -A && git commit -m \"chore: skeleton\"", { cwd: workspaceDir, shell: true, stdio: "ignore" });
  } catch {
    /* ignore if nothing to commit */
  }
}

function createMockSkeleton(workspaceDir) {
  mkdirSync(path.join(workspaceDir, "src"), { recursive: true });
  writeFileSync(path.join(workspaceDir, "package.json"), JSON.stringify({
    name: "mini-commonmark",
    type: "module",
    scripts: { build: "tsc" },
    devDependencies: { typescript: "^5.6.0", "@types/node": "^22.0.0" },
  }, null, 2));
  writeFileSync(path.join(workspaceDir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      outDir: "dist",
      rootDir: "src",
      strict: true,
    },
    include: ["src/**/*"],
  }, null, 2));
  writeFileSync(path.join(workspaceDir, "src", "cli.ts"), `import { renderMarkdown } from "./index.js";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", () => { process.stdout.write(renderMarkdown(input)); });
`);
  writeFileSync(path.join(workspaceDir, "src", "index.ts"), `export function renderMarkdown(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  return "<p>" + trimmed.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</p>\\n";
}
`);
  execSync("npm install", { cwd: workspaceDir, stdio: "ignore", shell: true });
  execSync("npm run build", { cwd: workspaceDir, stdio: "ignore", shell: true });
  execSync("git add -A && git commit -m \"mock skeleton\"", { cwd: workspaceDir, shell: true, stdio: "ignore" });
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    usage();
    process.exit(0);
  }

  const config = loadConfig({
    coordination: cli.coordination,
    mock: cli.mock,
    concurrency: cli.concurrency ?? undefined,
  });
  if (cli.coordination) config.coordination = true;
  if (cli.mock) config.mock = true;

  const runId = cli.runId || new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(ROOT, "runs", runId);
  const workspaceDir = path.join(runDir, "workspace");
  const worktreesRoot = path.join(runDir, "worktrees");
  mkdirSync(runDir, { recursive: true });

  const metrics = createMetricsCollector(runDir);
  metrics.setMeta({
    run_id: runId,
    coordination: config.coordination,
    quick: cli.quick,
    serial: cli.serial,
    mock: config.mock,
    models: config.models,
    concurrency: cli.serial ? 1 : (config.concurrency || 2),
  });

  console.log(`[run] id=${runId} coordination=${config.coordination} mock=${config.mock}`);

  initWorkspace(workspaceDir, config.coordination);
  initSkeleton(workspaceDir);

  let tasks = await runPlanner({
    workspaceDir,
    config,
    runDir,
    coordination: config.coordination,
    metrics,
  });

  if (cli.quick) {
    tasks = tasks.slice(0, 3);
    saveTasks(workspaceDir, tasks);
    console.log(`[run] quick mode: ${tasks.length} tasks`);
  }

  if (config.coordination) {
    let violations = validateDisjointScopes(tasks);
    let plannerRetries = 0;
    while (violations.length && plannerRetries < (config.maxPlannerRetries || 2)) {
      console.warn("[run] scope violations:", violations);
      const fixPrompt = `tasks.json has overlapping files_scope: ${JSON.stringify(violations)}. Fix tasks.json so scopes are disjoint. Say PLANNER_DONE.`;
      await spawnAgent({
        role: "planner",
        prompt: fixPrompt,
        cwd: workspaceDir,
        config,
        runDir,
        logKey: `planner-retry-${plannerRetries + 1}`,
        timeoutMs: (config.taskTimeoutMinutes || 20) * 60 * 1000,
      });
      tasks = loadTasks(workspaceDir) || tasks;
      violations = validateDisjointScopes(tasks);
      plannerRetries += 1;
    }
  }

  saveTasks(workspaceDir, tasks);
  writeFileSync(path.join(runDir, "tasks.json"), `${JSON.stringify(tasks, null, 2)}\n`, "utf8");

  if (config.mock) {
    createMockSkeleton(workspaceDir);
    const scorePath = path.join(runDir, "score-final.json");
    const scored = runScore(workspaceDir, scorePath);
    metrics.recordScore({ phase: "final", ...scored.report });
    metrics.finish({
      commits: commitCount(workspaceDir),
      loc: countLoc(workspaceDir),
      final_score: scored.report,
    });
    console.log(`[run] mock complete rate=${(scored.report.rate * 100).toFixed(1)}%`);
    process.exit(0);
  }

  const useWorktrees = !cli.serial && (config.concurrency || 2) > 1;
  const mergeQueue = new MergeQueue({
    mainDir: workspaceDir,
    config,
    runDir,
    metrics,
    coordination: config.coordination,
    designMd: readDesign(workspaceDir),
    resolveWithMerger: true,
  });

  const concurrency = cli.serial ? 1 : (config.concurrency || 2);

  async function executeTask(task) {
    metrics.recordTask({ id: task.id, status: "in_progress", started_at: new Date().toISOString() });
    const started = Date.now();

    if (useWorktrees && task.id !== "task-01") {
      mkdirSync(worktreesRoot, { recursive: true });
      let wt;
      try {
        wt = createWorktree(workspaceDir, worktreesRoot, task.id);
      } catch (err) {
        metrics.recordTask({ id: task.id, status: "failed", error: String(err.message) });
        return { task, ok: false };
      }

      const workerResult = await runWorkerTask({
        task,
        cwd: wt.path,
        config,
        runDir,
        coordination: config.coordination,
        metrics,
      });

      if (config.coordination) {
        const changed = filesChangedInWorktree(wt.path, workspaceDir);
        const violations = checkScopeViolation(changed, task.files_scope);
        if (violations.length) {
          metrics.recordConflict({ taskId: task.id, type: "scope_violation", files: violations });
          removeWorktree(workspaceDir, wt.path);
          metrics.recordTask({ id: task.id, status: "failed", scope_violation: violations });
          return { task, ok: false };
        }
      }

      const mergeResult = await mergeQueue.enqueue({
        branch: wt.branch,
        taskId: task.id,
        workerDir: wt.path,
      });
      removeWorktree(workspaceDir, wt.path);

      ensureBuilt(workspaceDir);
      const scorePath = path.join(runDir, `score-after-${task.id}.json`);
      const scored = runScore(workspaceDir, scorePath);
      metrics.recordScore({ phase: `after-${task.id}`, ...scored.report });

      metrics.recordTask({
        id: task.id,
        status: mergeResult.ok ? "done" : "failed",
        elapsedMs: Date.now() - started,
        worker_ok: workerResult.ok,
        merge: mergeResult,
      });
      return { task, ok: mergeResult.ok && workerResult.ok };
    }

    const workerResult = await runWorkerTask({
      task,
      cwd: workspaceDir,
      config,
      runDir,
      coordination: config.coordination,
      metrics,
    });

    ensureBuilt(workspaceDir);
    const scorePath = path.join(runDir, `score-after-${task.id}.json`);
    const scored = runScore(workspaceDir, scorePath);
    metrics.recordScore({ phase: `after-${task.id}`, ...scored.report });

    metrics.recordTask({
      id: task.id,
      status: workerResult.ok ? "done" : "failed",
      elapsedMs: Date.now() - started,
    });
    return { task, ok: workerResult.ok };
  }

  const skeletonTask = tasks.find((t) => t.id === "task-01") || tasks[0];
  const restTasks = tasks.filter((t) => t !== skeletonTask);

  if (useWorktrees && skeletonTask) {
    console.log("[run] skeleton task first:", skeletonTask.id);
    await executeTask(skeletonTask);
  }

  const poolTasks = useWorktrees ? restTasks : tasks;
  await runPool(poolTasks, concurrency, executeTask);

  // Optional reviewer on final diff
  const diff = getDiff(workspaceDir);
  ensureBuilt(workspaceDir);
  const finalScorePath = path.join(runDir, "score-final.json");
  const finalScored = runScore(workspaceDir, finalScorePath);
  metrics.recordScore({ phase: "final", ...finalScored.report });

  if (diff.trim()) {
    await spawnAgent({
      role: "reviewer",
      prompt: buildReviewerPrompt({
        diff: diff.slice(0, 8000),
        scoreSnapshot: JSON.stringify(finalScored.report, null, 2),
      }),
      cwd: workspaceDir,
      config,
      runDir,
      logKey: "reviewer-final",
      timeoutMs: 5 * 60 * 1000,
    });
  }

  const metricsPath = metrics.finish({
    commits: commitCount(workspaceDir),
    loc: countLoc(workspaceDir),
    final_score: finalScored.report,
  });

  console.log(`[run] done metrics=${metricsPath}`);
  console.log(`[run] pass rate ${(finalScored.report.rate * 100).toFixed(1)}% (${finalScored.report.passed}/${finalScored.report.total})`);
  console.log(`[run] conflicts=${metrics.data.conflict_count} loc=${countLoc(workspaceDir)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
