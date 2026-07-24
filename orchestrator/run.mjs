#!/usr/bin/env node
/**
 * mini-swarm orchestrator: planner → workers → merge → score.
 */
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { loadConfig, projectRoot } from "./lib/config.mjs";
import {
  abortMerge,
  commitCount,
  computeChurn,
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
  buildIntegrationFixPrompt,
  buildReviewerPrompt,
  buildWorkerPrompt,
  loadPrompt,
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
  if (!existsSync(path.join(workspaceDir, "package.json"))) return { ok: true, stderr: "" };
  try {
    execSync("npm install", { cwd: workspaceDir, stdio: "pipe", shell: true, encoding: "utf8" });
    execSync("npm run build", { cwd: workspaceDir, stdio: "pipe", shell: true, encoding: "utf8" });
    return { ok: true, stderr: "" };
  } catch (err) {
    const stderr = String(err.stderr || err.stdout || err.message || err);
    console.warn(`[run] build failed in ${workspaceDir}: ${stderr.slice(0, 500)}`);
    return { ok: false, stderr };
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
    coordMode: "strict",
    taskSet: "default",
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
    else if (a.startsWith("--coord-mode=")) args.coordMode = a.split("=")[1];
    else if (a.startsWith("--task-set=")) args.taskSet = a.split("=")[1];
  }
  return args;
}

function usage() {
  console.log(`Usage: node orchestrator/run.mjs [options]

Options:
  --coordination     Run B: disjoint scopes, DESIGN.md, GUIDE.md, neutral merger
  --coord-mode=MODE  strict (hard scope) or faithful (soft scope + repair loop)
  --task-set=SET     default (8 tasks) or contention (12 high-contention tasks, seed planner)
  --quick            Only first 3 tasks (cheaper experiment)
  --serial           Concurrency 1, no worktrees (minimal loop)
  --mock             Skip LLM agents; seed tasks + stub workspace only
  --run-id=ID        Custom run id (default: timestamp)
  --concurrency=N    Override config concurrency
`);
}

function writeContentionDesign(workspaceDir) {
  const design = loadPrompt("design-contention");
  writeFileSync(path.join(workspaceDir, "DESIGN.md"), design, "utf8");
  if (!existsSync(path.join(workspaceDir, "GUIDE.md"))) {
    writeFileSync(path.join(workspaceDir, "GUIDE.md"), "# Field Guide\n\nTips for workers.\n", "utf8");
  }
}

async function runPlanner({ workspaceDir, config, runDir, coordination, coordMode, metrics, taskSet }) {
  const plannerCoordMode = coordination ? coordMode : "none";

  // Contention set is fixed for fair A/B; skip LLM planner noise.
  if (taskSet === "contention") {
    const tasks = seedTasks(workspaceDir, "contention", plannerCoordMode);
    metrics.setMeta({ planner_source: "seed-contention" });
    if (coordination) writeContentionDesign(workspaceDir);
    return tasks;
  }

  const examplesPath = path.join(ROOT, "spec", "examples.json");
  const sections = sectionSummary();
  const prompt = `${buildPlannerPrompt({ coordination, coordMode })}

## Spec sections (example counts)

${JSON.stringify(sections, null, 2)}

Examples file path: ${examplesPath}

Write tasks.json in the workspace root. If coordination is on, also write DESIGN.md and GUIDE.md.
`;

  if (config.mock) {
    seedTasks(workspaceDir, "default", plannerCoordMode);
    metrics.setMeta({ planner_source: "seed" });
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
  if (result.ok && tasks?.length) {
    metrics.setMeta({ planner_source: "llm" });
    return tasks;
  }

  if (!result.ok) {
    console.warn(`[run] planner failed (exit ${result.code}); using seed tasks`);
  } else {
    console.warn("[run] planner did not produce tasks.json; using seed tasks");
  }
  metrics.setMeta({ planner_source: "seed" });
  tasks = seedTasks(workspaceDir, "default", plannerCoordMode);
  return tasks;
}

async function runWorkerTask({
  task,
  cwd,
  config,
  runDir,
  coordination,
  coordMode,
  metrics,
}) {
  const designMd = readDesign(cwd);
  const guideMd = readGuide(cwd);
  const prompt = buildWorkerPrompt({ task, designMd, guideMd, coordMode });
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

async function ensureBuiltWithRepair({ workspaceDir, config, runDir, metrics, taskId }) {
  let build = ensureBuilt(workspaceDir);
  if (build.ok) return { ok: true, attempts: 0 };

  const maxRetries = config.maxIntegrationFixRetries ?? 2;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const result = await spawnAgent({
      role: "worker",
      prompt: buildIntegrationFixPrompt({
        buildError: build.stderr,
        designMd: readDesign(workspaceDir),
        diff: getDiff(workspaceDir).slice(0, 8000),
      }),
      cwd: workspaceDir,
      config,
      runDir,
      logKey: `integration-fix-${taskId}-${attempt}`,
      timeoutMs: (config.taskTimeoutMinutes || 20) * 60 * 1000,
    });
    build = ensureBuilt(workspaceDir);
    metrics.recordIntegrationFix({
      taskId,
      attempt,
      agent_ok: result.ok,
      build_ok: build.ok,
      elapsedMs: result.elapsedMs,
    });
    metrics.recordAgentCall({
      role: "integration-fix",
      taskId,
      attempt,
      ok: result.ok && build.ok,
      elapsedMs: result.elapsedMs,
    });
    if (build.ok) return { ok: true, attempts: attempt };
  }
  return { ok: false, attempts: maxRetries, stderr: build.stderr };
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

function writeContentionStubs(workspaceDir, { coordination }) {
  mkdirSync(path.join(workspaceDir, "src", "blocks"), { recursive: true });
  mkdirSync(path.join(workspaceDir, "src", "inline"), { recursive: true });

  writeFileSync(path.join(workspaceDir, "src", "types.ts"), `export interface BlockNode {
  type: string;
  [k: string]: unknown;
}

export interface InlineNode {
  type: string;
  [k: string]: unknown;
}
`, "utf8");

  writeFileSync(path.join(workspaceDir, "src", "blocks", "registry.ts"), `import type { BlockNode } from "../types.js";

export type BlockParser = (
  lines: string[],
  pos: number,
) => { node: BlockNode; next: number } | null;

const parsers: BlockParser[] = [];

export function registerBlockParser(p: BlockParser): void {
  parsers.push(p);
}

export function getBlockParsers(): BlockParser[] {
  return parsers.slice();
}
`, "utf8");

  writeFileSync(path.join(workspaceDir, "src", "inline", "registry.ts"), `import type { InlineNode } from "../types.js";

export type InlineParser = (
  text: string,
  pos: number,
) => { node: InlineNode; next: number } | null;

const parsers: InlineParser[] = [];

export function registerInlineParser(p: InlineParser): void {
  parsers.push(p);
}

export function getInlineParsers(): InlineParser[] {
  return parsers.slice();
}
`, "utf8");

  writeFileSync(path.join(workspaceDir, "src", "render.ts"), `import type { BlockNode } from "./types.js";

export function renderNode(node: BlockNode): string {
  switch (node.type) {
    case "paragraph": {
      const text = typeof node.text === "string" ? node.text : "";
      return text ? "<p>" + text + "</p>\\n" : "";
    }
    default:
      return "";
  }
}
`, "utf8");

  writeFileSync(path.join(workspaceDir, "src", "index.ts"), `import { getBlockParsers } from "./blocks/registry.js";
import { renderNode } from "./render.js";
import type { BlockNode } from "./types.js";

function parseBlocks(input: string): BlockNode[] {
  const lines = input.replace(/\\r\\n/g, "\\n").split("\\n");
  const nodes: BlockNode[] = [];
  let pos = 0;
  const parsers = getBlockParsers();
  while (pos < lines.length) {
    let matched = false;
    for (const parser of parsers) {
      const result = parser(lines, pos);
      if (result) {
        nodes.push(result.node);
        pos = result.next;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Fallback paragraph so empty-registry skeleton still scores like the old stub.
      const text = lines[pos] ?? "";
      if (text.trim()) nodes.push({ type: "paragraph", text: text.trim() });
      pos += 1;
    }
  }
  return nodes;
}

export function renderMarkdown(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  return parseBlocks(input).map(renderNode).join("");
}
`, "utf8");

  if (coordination) {
    writeFileSync(path.join(workspaceDir, "src", "contracts.ts"), `/**
 * Compile-checked design references.
 * Interface changes MUST update this file; tsc enforces consistency with DESIGN.md.
 */
export type { BlockNode, InlineNode } from "./types.js";
export type { BlockParser } from "./blocks/registry.js";
export type { InlineParser } from "./inline/registry.js";
export { registerBlockParser, getBlockParsers } from "./blocks/registry.js";
export { registerInlineParser, getInlineParsers } from "./inline/registry.js";
export { renderNode } from "./render.js";
`, "utf8");
  }
}

function initSkeleton(workspaceDir, { taskSet = "default", coordination = false } = {}) {
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

  if (taskSet === "contention") {
    writeContentionStubs(workspaceDir, { coordination });
  } else {
    writeFileSync(path.join(workspaceDir, "src", "index.ts"), `export function renderMarkdown(input: string): string {
  return input.trim() ? "<p>" + input.trim() + "</p>\\n" : "";
}
`);
  }

  try {
    execSync("git add -A && git commit -m \"chore: skeleton\"", { cwd: workspaceDir, shell: true, stdio: "ignore" });
  } catch {
    /* ignore if nothing to commit */
  }
}

function createMockSkeleton(workspaceDir, { taskSet = "default", coordination = false } = {}) {
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
  if (taskSet === "contention") {
    writeContentionStubs(workspaceDir, { coordination });
  } else {
    writeFileSync(path.join(workspaceDir, "src", "index.ts"), `export function renderMarkdown(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  return "<p>" + trimmed.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</p>\\n";
}
`);
  }
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
  if (!["strict", "faithful"].includes(cli.coordMode)) {
    throw new Error(`Invalid --coord-mode=${cli.coordMode}; expected strict or faithful`);
  }
  if (!["default", "contention"].includes(cli.taskSet)) {
    throw new Error(`Invalid --task-set=${cli.taskSet}; expected default or contention`);
  }
  if (cli.coordMode === "faithful") cli.coordination = true;

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
    coordination_mode: config.coordination ? cli.coordMode : "none",
    task_set: cli.taskSet,
  });

  console.log(`[run] id=${runId} coordination=${config.coordination} taskSet=${cli.taskSet} mock=${config.mock}`);

  initWorkspace(workspaceDir, config.coordination);
  if (!config.mock) {
    initSkeleton(workspaceDir, { taskSet: cli.taskSet, coordination: config.coordination });
  }

  let tasks = await runPlanner({
    workspaceDir,
    config,
    runDir,
    coordination: config.coordination,
    coordMode: cli.coordMode,
    metrics,
    taskSet: cli.taskSet,
  });

  if (cli.quick) {
    tasks = tasks.slice(0, 3);
    saveTasks(workspaceDir, tasks);
    console.log(`[run] quick mode: ${tasks.length} tasks`);
  }

  if (config.coordination) {
    // Contention: task-01 owns shared pipeline files and runs first; skip it in disjoint check.
    const skipTaskIds = cli.taskSet === "contention" ? ["task-01"] : [];
    let violations = validateDisjointScopes(tasks, { skipTaskIds });
    let plannerRetries = 0;
    // Seed-contention scopes are authored to be disjoint; skip LLM fix loop.
    const allowPlannerFix = cli.taskSet !== "contention" && !config.mock;
    while (violations.length && allowPlannerFix && plannerRetries < (config.maxPlannerRetries || 2)) {
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
      violations = validateDisjointScopes(tasks, { skipTaskIds });
      plannerRetries += 1;
    }
    if (violations.length) {
      console.warn("[run] remaining scope overlaps (continuing):", violations);
    }
  }

  saveTasks(workspaceDir, tasks);
  writeFileSync(path.join(runDir, "tasks.json"), `${JSON.stringify(tasks, null, 2)}\n`, "utf8");

  if (config.mock) {
    createMockSkeleton(workspaceDir, { taskSet: cli.taskSet, coordination: config.coordination });
    const scorePath = path.join(runDir, "score-final.json");
    const scored = runScore(workspaceDir, scorePath);
    metrics.recordScore({ phase: "final", ...scored.report });
    const agentCalls = metrics.data.agent_calls || [];
    metrics.finish({
      commits: commitCount(workspaceDir),
      loc: countLoc(workspaceDir),
      final_score: scored.report,
      churn: computeChurn(workspaceDir),
      merge_resolve_time_ms: agentCalls
        .filter((c) => c.phase === "merge-resolve")
        .reduce((s, c) => s + (c.elapsedMs || 0), 0),
      integration_fix_time_ms: agentCalls
        .filter((c) => c.role === "integration-fix")
        .reduce((s, c) => s + (c.elapsedMs || 0), 0),
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
        coordMode: cli.coordMode,
        metrics,
      });

      if (config.coordination) {
        const changed = filesChangedInWorktree(wt.path);
        const violations = checkScopeViolation(changed, task.files_scope, {
          allowDesign: cli.coordMode === "faithful",
        });
        if (violations.length) {
          if (cli.coordMode === "faithful") {
            metrics.recordCrossScopeChange({ taskId: task.id, files: violations });
          } else {
            metrics.recordScopeViolation({ taskId: task.id, files: violations });
            removeWorktree(workspaceDir, wt.path);
            metrics.recordTask({ id: task.id, status: "failed", scope_violation: violations });
            return { task, ok: false };
          }
        }
      }

      const mergeResult = await mergeQueue.enqueue({
        branch: wt.branch,
        taskId: task.id,
        afterMerge: cli.coordMode === "faithful"
          ? () => ensureBuiltWithRepair({
            workspaceDir,
            config,
            runDir,
            metrics,
            taskId: task.id,
          })
          : null,
      });
      removeWorktree(workspaceDir, wt.path);

      if (cli.coordMode !== "faithful") ensureBuilt(workspaceDir);
      const scorePath = path.join(runDir, `score-after-${task.id}.json`);
      const scored = runScore(workspaceDir, scorePath);
      metrics.recordScore({ phase: `after-${task.id}`, ...scored.report });

      metrics.recordTask({
        id: task.id,
        status: mergeResult.ok && mergeResult.postMerge?.ok !== false ? "done" : "failed",
        elapsedMs: Date.now() - started,
        worker_ok: workerResult.ok,
        merge: mergeResult,
      });
      return {
        task,
        ok: mergeResult.ok && mergeResult.postMerge?.ok !== false && workerResult.ok,
      };
    }

    const workerResult = await runWorkerTask({
      task,
      cwd: workspaceDir,
      config,
      runDir,
      coordination: config.coordination,
      coordMode: cli.coordMode,
      metrics,
    });

    const buildResult = cli.coordMode === "faithful"
      ? await ensureBuiltWithRepair({
        workspaceDir,
        config,
        runDir,
        metrics,
        taskId: task.id,
      })
      : ensureBuilt(workspaceDir);
    const scorePath = path.join(runDir, `score-after-${task.id}.json`);
    const scored = runScore(workspaceDir, scorePath);
    metrics.recordScore({ phase: `after-${task.id}`, ...scored.report });

    metrics.recordTask({
      id: task.id,
      status: workerResult.ok && buildResult.ok ? "done" : "failed",
      elapsedMs: Date.now() - started,
    });
    return { task, ok: workerResult.ok && buildResult.ok };
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
  if (cli.coordMode === "faithful") {
    await ensureBuiltWithRepair({
      workspaceDir,
      config,
      runDir,
      metrics,
      taskId: "final",
    });
  } else {
    ensureBuilt(workspaceDir);
  }
  const finalScorePath = path.join(runDir, "score-final.json");
  const finalScored = runScore(workspaceDir, finalScorePath);
  metrics.recordScore({ phase: "final", ...finalScored.report });

  if (diff.trim()) {
    const reviewResult = await spawnAgent({
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
    metrics.recordAgentCall({
      role: "reviewer",
      ok: reviewResult.ok,
      elapsedMs: reviewResult.elapsedMs,
    });
  }

  const agentCalls = metrics.data.agent_calls || [];
  const metricsPath = metrics.finish({
    commits: commitCount(workspaceDir),
    loc: countLoc(workspaceDir),
    final_score: finalScored.report,
    tasks_done: metrics.data.tasks.filter((t) => t.status === "done").length,
    churn: computeChurn(workspaceDir),
    merge_resolve_time_ms: agentCalls
      .filter((c) => c.phase === "merge-resolve")
      .reduce((s, c) => s + (c.elapsedMs || 0), 0),
    integration_fix_time_ms: agentCalls
      .filter((c) => c.role === "integration-fix")
      .reduce((s, c) => s + (c.elapsedMs || 0), 0),
  });

  console.log(`[run] done metrics=${metricsPath}`);
  console.log(`[run] pass rate ${(finalScored.report.rate * 100).toFixed(1)}% (${finalScored.report.passed}/${finalScored.report.total})`);
  console.log(`[run] merge_conflicts=${metrics.data.merge_conflict_count} scope_violations=${metrics.data.scope_violation_count} loc=${countLoc(workspaceDir)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
