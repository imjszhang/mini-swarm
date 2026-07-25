#!/usr/bin/env node
/**
 * mini-swarm orchestrator: planner → workers → merge → score.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
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
  commitAll,
  commitCount,
  computeChurn,
  createWorktree,
  deleteTaskBranches,
  filesChangedInWorktree,
  findConflictMarkers,
  getDiff,
  headSha,
  initRepo,
  isBranchMergedInto,
  isDirty,
  listTaskBranches,
  listTrackedFiles,
  readDesign,
  readGuide,
  removeWorktree,
  resetHard,
  revListCount,
  syncWorktreeWithMain,
} from "./lib/git.mjs";
import {
  createInitialProgress,
  loadProgress,
  markPhase,
  markRepairRound,
  markTask,
  saveProgress,
} from "./lib/progress.mjs";
import {
  buildPlannerPrompt,
  buildGlobalRepairPrompt,
  buildIntegrationFixPrompt,
  buildReviewerPrompt,
  buildWorkerPrompt,
  buildWorkerScoreFixPrompt,
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
  const pkgPath = path.join(workspaceDir, "package.json");
  if (!existsSync(pkgPath)) return { ok: true, stderr: "" };
  try {
    const hash = createHash("sha1").update(readFileSync(pkgPath, "utf8")).digest("hex");
    const stamp = path.join(workspaceDir, "node_modules", ".pkg-hash");
    const skipInstall = existsSync(stamp) && readFileSync(stamp, "utf8") === hash;
    if (!skipInstall) {
      execSync("npm install", { cwd: workspaceDir, stdio: "pipe", shell: true, encoding: "utf8" });
      writeFileSync(stamp, hash, "utf8");
    }
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
    resume: false,
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
    else if (a === "--resume") args.resume = true;
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
  --resume           Resume an interrupted run (requires --run-id; needs progress.json, see npm run salvage)
  --concurrency=N    Override config concurrency
`);
}

/**
 * Win32: leftover orchestrator / cursor-agent processes for this runId.
 * Only node/cursor-agent; excludes this process and its parent (npm wrapper).
 */
function findLeftoverRunProcesses(runId) {
  if (process.platform !== "win32") return [];
  try {
    const self = process.pid;
    const parent = process.ppid || 0;
    const ps = [
      "$procs = Get-CimInstance Win32_Process | Where-Object {",
      `  $_.ProcessId -ne ${self} -and $_.ProcessId -ne ${parent}`,
      "  -and ($_.Name -eq 'node.exe' -or $_.Name -like 'cursor-agent*')",
      `  -and $_.CommandLine -like '*${runId}*'`,
      "  -and (",
      "    $_.CommandLine -like '*orchestrator*run.mjs*' -or",
      "    $_.CommandLine -like '*cursor-agent*' -or",
      `    $_.CommandLine -like '*runs*${runId}*workspace*'`,
      "  )",
      "};",
      "$procs | ForEach-Object { \"$($_.ProcessId)`t$($_.Name)`t$($_.CommandLine)\" }",
    ].join(" ");
    const out = execSync(`powershell -NoProfile -Command ${JSON.stringify(ps)}`, {
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
    if (!out) return [];
    return out.split("\n").map((line) => {
      const [pid, name, ...rest] = line.trim().split("\t");
      return { pid, name, cmd: rest.join("\t") };
    }).filter((p) => p.pid && Number(p.pid) !== self && Number(p.pid) !== parent);
  } catch {
    return [];
  }
}

function assertFingerprintMatch(expected, actual) {
  for (const key of ["task_set", "coordination_mode", "quick", "serial"]) {
    if (expected[key] !== actual[key]) {
      throw new Error(
        `Fingerprint mismatch on ${key}: resume=${JSON.stringify(actual)} vs cli=${JSON.stringify(expected)}`,
      );
    }
  }
}

function healWorkspace(workspaceDir) {
  for (let i = 0; i < 15; i += 1) {
    const files = listTrackedFiles(workspaceDir).filter((f) => {
      const n = f.replace(/\\/g, "/");
      return (n.startsWith("src/") && n.endsWith(".ts")) || n.endsWith(".md");
    });
    const hits = findConflictMarkers(workspaceDir, files);
    const build = ensureBuilt(workspaceDir);
    if (!hits.length && build.ok) {
      console.log(`[run] workspace healthy after ${i} walkback(s)`);
      return;
    }
    if (revListCount(workspaceDir) <= 2) {
      throw new Error("Workspace unrecoverable: conflict markers or build failure near init");
    }
    console.warn(`[run] heal walkback ${i + 1}: markers=${hits.length} build_ok=${build.ok}`);
    resetHard(workspaceDir, "HEAD~1");
  }
  throw new Error("Workspace unrecoverable after 15 walkbacks");
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

/**
 * Worker + optional section-scoped score feedback rounds (harness-level, both arms).
 * When syncWithMain is true, merge main into the worktree before each feedback round.
 */
async function runWorkerWithScoreFeedback({
  task,
  cwd,
  config,
  runDir,
  coordination,
  coordMode,
  metrics,
  syncWithMain = false,
}) {
  const initial = await runWorkerTask({
    task,
    cwd,
    config,
    runDir,
    coordination,
    coordMode,
    metrics,
  });

  const maxRounds = config.maxScoreFeedbackRounds ?? 0;
  const target = config.scoreFeedbackTarget ?? 1.0;
  if (maxRounds <= 0) return initial;

  const sections = task.spec_sections || [];
  if (!sections.length) return initial;

  let lastResult = initial;
  let prevRate = null;

  for (let round = 1; round <= maxRounds; round += 1) {
    let syncConflictNote = null;
    if (syncWithMain) {
      const sync = syncWorktreeWithMain(cwd);
      metrics.recordWorktreeSync({
        taskId: task.id,
        round,
        conflict: !!sync.conflict,
        files: sync.files || [],
      });
      if (sync.conflict) {
        syncConflictNote = `An in-progress merge from main has CONFLICTS in: ${(sync.files || []).join(", ") || "(unknown)"}. First resolve every conflict (reconcile both sides' intent), remove all conflict markers, commit the merge. Then fix the failing examples.`;
        console.warn(`[run] ${task.id} feedback round ${round}: sync conflict`);
      }
    }

    let rate = 0;
    let failures = [];
    let buildError = null;
    let buildOk = false;

    if (syncConflictNote) {
      buildError = syncConflictNote;
      rate = 0;
      buildOk = false;
    } else {
      const build = ensureBuilt(cwd);
      buildOk = build.ok;
      if (!build.ok) {
        buildError = build.stderr || "build failed";
        rate = 0;
        console.warn(`[run] ${task.id} feedback round ${round}: build failed`);
      } else {
        const scorePath = path.join(runDir, `score-feedback-${task.id}-${round}.json`);
        const scored = runScore(cwd, scorePath, { sections });
        rate = scored.report?.rate ?? 0;
        failures = scored.report?.failures || [];
        console.log(`[run] ${task.id} feedback round ${round}: section rate=${(rate * 100).toFixed(1)}%`);
      }
    }

    metrics.recordScoreFeedback({
      taskId: task.id,
      round,
      rate_before: prevRate,
      rate_after: rate,
      build_ok: buildOk,
      failure_count: failures.length,
      sync_conflict: !!syncConflictNote,
    });

    if (buildOk && rate >= target) break;

    const fixPrompt = buildWorkerScoreFixPrompt({
      task,
      sections,
      rate,
      failures,
      coordMode,
      buildError,
    });
    const fixResult = await spawnAgent({
      role: "worker",
      prompt: fixPrompt,
      cwd,
      config,
      runDir,
      logKey: `worker-${task.id}-fix-${round}`,
      timeoutMs: (config.taskTimeoutMinutes || 20) * 60 * 1000,
    });
    metrics.recordAgentCall({
      role: "worker-fix",
      taskId: task.id,
      round,
      ok: fixResult.ok,
      elapsedMs: fixResult.elapsedMs,
    });
    lastResult = fixResult;
    prevRate = rate;

    // After the last fix, re-score once so metrics capture the final rate_after.
    if (round === maxRounds) {
      const buildFinal = ensureBuilt(cwd);
      let finalRate = 0;
      let finalFailures = 0;
      if (buildFinal.ok) {
        const scorePath = path.join(runDir, `score-feedback-${task.id}-final.json`);
        const scored = runScore(cwd, scorePath, { sections });
        finalRate = scored.report?.rate ?? 0;
        finalFailures = (scored.report?.failures || []).length;
        console.log(`[run] ${task.id} feedback final: section rate=${(finalRate * 100).toFixed(1)}%`);
      }
      metrics.recordScoreFeedback({
        taskId: task.id,
        round: `${round}-final`,
        rate_before: prevRate,
        rate_after: finalRate,
        build_ok: buildFinal.ok,
        failure_count: finalFailures,
      });
    }
  }

  return lastResult;
}

function pickWorstSections(bySection, topN) {
  return Object.entries(bySection || {})
    .map(([name, st]) => ({
      name,
      passed: st.passed || 0,
      total: st.total || 0,
      rate: st.rate || 0,
      failed: (st.total || 0) - (st.passed || 0),
    }))
    .filter((s) => s.failed > 0)
    .sort((a, b) => b.failed - a.failed || a.rate - b.rate)
    .slice(0, topN);
}

/**
 * Final global repair phase: score full suite, fix worst sections, with regression guard.
 */
async function runGlobalRepairPhase({
  workspaceDir,
  config,
  runDir,
  coordMode,
  metrics,
  progress = null,
}) {
  const maxRounds = config.maxGlobalRepairRounds ?? 0;
  if (config.mock || maxRounds <= 0) return;

  const topN = config.globalRepairTopSections ?? 3;
  const target = config.globalRepairTarget ?? 1.0;
  const minGainPp = config.globalRepairMinGainPp ?? 0.5;
  const startRound = (progress?.global_repair_rounds_done ?? 0) + 1;

  for (let r = startRound; r <= maxRounds; r += 1) {
    const build = ensureBuilt(workspaceDir);
    if (!build.ok) {
      console.warn(`[run] global repair round ${r}: build failed; skipping phase`);
      return;
    }

    const beforePath = path.join(runDir, `score-global-before-${r}.json`);
    const scored = runScore(workspaceDir, beforePath);
    metrics.recordScore({ phase: `global-before-${r}`, ...scored.report });
    const rateBefore = scored.report?.rate ?? 0;
    console.log(`[run] global repair round ${r}: rate=${(rateBefore * 100).toFixed(1)}%`);
    if (rateBefore >= target) break;

    const worst = pickWorstSections(scored.report?.by_section, topN);
    if (!worst.length) break;
    const sections = worst.map((s) => s.name);
    const detailPath = path.join(runDir, `score-global-${r}-sections.json`);
    const detail = runScore(workspaceDir, detailPath, { sections });

    commitAll(workspaceDir, `checkpoint: pre-repair ${r}`);
    const checkpointSha = headSha(workspaceDir);

    const prompt = buildGlobalRepairPrompt({
      rate: rateBefore,
      bySection: worst,
      failures: detail.report?.failures || scored.report?.failures || [],
      coordMode,
    });
    const result = await spawnAgent({
      role: "worker",
      prompt,
      cwd: workspaceDir,
      config,
      runDir,
      logKey: `global-repair-${r}`,
      timeoutMs: (config.taskTimeoutMinutes || 20) * 60 * 1000,
    });
    metrics.recordAgentCall({
      role: "global-repair",
      round: r,
      ok: result.ok,
      elapsedMs: result.elapsedMs,
    });

    commitAll(workspaceDir, `global repair ${r}`);

    const build2 = ensureBuilt(workspaceDir);
    let rateAfter = rateBefore;
    let reverted = false;
    if (!build2.ok) {
      resetHard(workspaceDir, checkpointSha);
      reverted = true;
      console.warn(`[run] global repair round ${r}: build broke; reverted`);
    } else {
      const afterPath = path.join(runDir, `score-global-after-${r}.json`);
      const scored2 = runScore(workspaceDir, afterPath);
      metrics.recordScore({ phase: `global-after-${r}`, ...scored2.report });
      const nextRate = scored2.report?.rate ?? 0;
      if (nextRate < rateBefore) {
        resetHard(workspaceDir, checkpointSha);
        reverted = true;
        console.warn(`[run] global repair round ${r}: rate dropped; reverted`);
      } else {
        rateAfter = nextRate;
        console.log(`[run] global repair round ${r}: rate=${(rateAfter * 100).toFixed(1)}%`);
      }
    }

    metrics.recordGlobalRepair({
      round: r,
      sections,
      rate_before: rateBefore,
      rate_after: rateAfter,
      reverted,
    });
    if (progress) markRepairRound(runDir, progress, r);

    if ((rateAfter - rateBefore) * 100 < minGainPp) break;
  }
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

  if (cli.resume && !cli.runId) {
    throw new Error("--resume requires --run-id=ID");
  }
  if (cli.resume && cli.mock) {
    throw new Error("--resume cannot be combined with --mock");
  }

  const runId = cli.runId || new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(ROOT, "runs", runId);
  const workspaceDir = path.join(runDir, "workspace");
  const worktreesRoot = path.join(runDir, "worktrees");
  mkdirSync(runDir, { recursive: true });

  const fingerprint = {
    task_set: cli.taskSet,
    coordination_mode: config.coordination ? cli.coordMode : "none",
    quick: !!cli.quick,
    serial: !!cli.serial,
  };

  const metrics = createMetricsCollector(runDir);
  metrics.setMeta({
    run_id: runId,
    coordination: config.coordination,
    quick: cli.quick,
    serial: cli.serial,
    mock: config.mock,
    models: config.models,
    concurrency: cli.serial ? 1 : (config.concurrency || 2),
    coordination_mode: fingerprint.coordination_mode,
    task_set: cli.taskSet,
  });

  console.log(`[run] id=${runId} coordination=${config.coordination} taskSet=${cli.taskSet} mock=${config.mock} resume=${cli.resume}`);

  let tasks;
  let progress = null;

  if (cli.resume) {
    if (!existsSync(runDir) || !existsSync(workspaceDir)) {
      throw new Error(`Resume failed: missing run/workspace under ${runDir}`);
    }
    const tasksPath = path.join(runDir, "tasks.json");
    if (!existsSync(tasksPath)) {
      throw new Error(`Resume failed: missing ${tasksPath}`);
    }
    progress = loadProgress(runDir);
    if (!progress) {
      throw new Error(`Resume failed: missing progress.json — run: npm run salvage -- --run-id=${runId} ...`);
    }
    if (progress.phase === "finished") {
      throw new Error(`Run ${runId} already finished (progress.phase=finished)`);
    }
    assertFingerprintMatch(fingerprint, progress.fingerprint || {});

    const leftovers = findLeftoverRunProcesses(runId);
    if (leftovers.length) {
      const list = leftovers.map((p) => `${p.pid} ${p.name}`).join(", ");
      throw new Error(`Resume blocked: leftover processes for ${runId}: ${list}. Kill them first.`);
    }

    try {
      execSync("git worktree prune", { cwd: workspaceDir, stdio: "pipe", shell: true });
    } catch {
      /* ignore */
    }
    rmSync(worktreesRoot, { recursive: true, force: true });
    abortMerge(workspaceDir);
    if (isDirty(workspaceDir)) resetHard(workspaceDir, "HEAD");

    healWorkspace(workspaceDir);

    const branches = new Set(listTaskBranches(workspaceDir));
    for (const taskId of Object.keys(progress.tasks || {})) {
      if (taskId === "task-01") continue;
      const branch = `task/${taskId}`;
      if (branches.has(branch) && isBranchMergedInto(workspaceDir, branch, "main")) {
        progress.tasks[taskId] = "done";
      } else if (branches.has(branch)) {
        progress.tasks[taskId] = "pending";
      }
      // else: keep progress status (branch gone)
    }
    deleteTaskBranches(workspaceDir);
    saveProgress(runDir, progress);

    tasks = JSON.parse(readFileSync(tasksPath, "utf8"));
    saveTasks(workspaceDir, tasks);

    metrics.setMeta({
      resumed: true,
      resume_segment: (progress.segments?.length || 0) + 1,
      planner_source: cli.taskSet === "contention" ? "seed-contention" : "seed",
    });
    for (const [taskId, status] of Object.entries(progress.tasks || {})) {
      if (status === "done") {
        metrics.recordTask({ id: taskId, status: "done", carried_over: true });
      }
    }
    progress.segments = progress.segments || [];
    progress.segments.push({ started_at: new Date().toISOString() });
    saveProgress(runDir, progress);
    console.log(`[run] resumed phase=${progress.phase} done=${Object.values(progress.tasks).filter((s) => s === "done").length}/${tasks.length}`);
  } else {
    initWorkspace(workspaceDir, config.coordination);
    if (!config.mock) {
      initSkeleton(workspaceDir, { taskSet: cli.taskSet, coordination: config.coordination });
    }

    tasks = await runPlanner({
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

    if (!config.mock) {
      progress = createInitialProgress({ runId, fingerprint, tasks });
      saveProgress(runDir, progress);
    }
  }

  if (progress) {
    const flush = () => {
      try { saveProgress(runDir, progress); } catch { /* ignore */ }
    };
    process.once("SIGINT", () => { flush(); process.exit(130); });
    process.once("SIGTERM", () => { flush(); process.exit(143); });
  }

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
      worker_fix_time_ms: agentCalls
        .filter((c) => c.role === "worker-fix")
        .reduce((s, c) => s + (c.elapsedMs || 0), 0),
      global_repair_time_ms: 0,
    });
    console.log(`[run] mock complete rate=${(scored.report.rate * 100).toFixed(1)}%`);
    process.exit(0);
  }

  const useWorktrees = !cli.serial && (config.concurrency || 2) > 1;
  // Worktree sync is off for strict (freeze that control arm); on for bare + faithful.
  const syncEnabled = (config.worktreeSync ?? true)
    && !(config.coordination && cli.coordMode === "strict");
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
    if (progress && progress.tasks[task.id] === "done") {
      console.log(`[run] skip ${task.id} (done in previous segment)`);
      return { task, ok: true, skipped: true };
    }

    metrics.recordTask({ id: task.id, status: "in_progress", started_at: new Date().toISOString() });
    if (progress) markTask(runDir, progress, task.id, "in_progress");
    const started = Date.now();

    if (useWorktrees && task.id !== "task-01") {
      mkdirSync(worktreesRoot, { recursive: true });
      let wt;
      try {
        wt = createWorktree(workspaceDir, worktreesRoot, task.id);
      } catch (err) {
        metrics.recordTask({ id: task.id, status: "failed", error: String(err.message) });
        if (progress) markTask(runDir, progress, task.id, "failed");
        return { task, ok: false };
      }

      const workerResult = await runWorkerWithScoreFeedback({
        task,
        cwd: wt.path,
        config,
        runDir,
        coordination: config.coordination,
        coordMode: cli.coordMode,
        metrics,
        syncWithMain: syncEnabled,
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
            if (progress) markTask(runDir, progress, task.id, "failed");
            return { task, ok: false };
          }
        }
      }

      if (syncEnabled) {
        const preSync = syncWorktreeWithMain(wt.path);
        metrics.recordWorktreeSync({
          taskId: task.id,
          round: "pre-merge",
          conflict: !!preSync.conflict,
          files: preSync.files || [],
        });
        if (preSync.conflict) abortMerge(wt.path);
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

      const status = mergeResult.ok && mergeResult.postMerge?.ok !== false ? "done" : "failed";
      metrics.recordTask({
        id: task.id,
        status,
        elapsedMs: Date.now() - started,
        worker_ok: workerResult.ok,
        merge: mergeResult,
      });
      if (progress) markTask(runDir, progress, task.id, status);
      return {
        task,
        ok: mergeResult.ok && mergeResult.postMerge?.ok !== false && workerResult.ok,
      };
    }

    const workerResult = await runWorkerWithScoreFeedback({
      task,
      cwd: workspaceDir,
      config,
      runDir,
      coordination: config.coordination,
      coordMode: cli.coordMode,
      metrics,
      syncWithMain: false,
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

    const status = workerResult.ok && buildResult.ok ? "done" : "failed";
    metrics.recordTask({
      id: task.id,
      status,
      elapsedMs: Date.now() - started,
    });
    if (progress) markTask(runDir, progress, task.id, status);
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

  // Final build, then global repair (both arms), then final score + reviewer.
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

  if (progress) markPhase(runDir, progress, "global_repair");
  await runGlobalRepairPhase({
    workspaceDir,
    config,
    runDir,
    coordMode: cli.coordMode,
    metrics,
    progress,
  });

  const finalScorePath = path.join(runDir, "score-final.json");
  const finalScored = runScore(workspaceDir, finalScorePath);
  metrics.recordScore({ phase: "final", ...finalScored.report });

  const diff = getDiff(workspaceDir);
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
    worker_fix_time_ms: agentCalls
      .filter((c) => c.role === "worker-fix")
      .reduce((s, c) => s + (c.elapsedMs || 0), 0),
    global_repair_time_ms: agentCalls
      .filter((c) => c.role === "global-repair")
      .reduce((s, c) => s + (c.elapsedMs || 0), 0),
  });
  if (progress) markPhase(runDir, progress, "finished");

  console.log(`[run] done metrics=${metricsPath}`);
  console.log(`[run] pass rate ${(finalScored.report.rate * 100).toFixed(1)}% (${finalScored.report.passed}/${finalScored.report.total})`);
  console.log(`[run] merge_conflicts=${metrics.data.merge_conflict_count} scope_violations=${metrics.data.scope_violation_count} loc=${countLoc(workspaceDir)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
