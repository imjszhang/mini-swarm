#!/usr/bin/env node
/**
 * Rebuild progress.json from an interrupted run's wreckage.
 * Writes ONLY progress.json — never mutates the workspace.
 *
 * Fingerprint flags MUST match the original run command, e.g.:
 *   npm run salvage -- --run-id=run-a-bare-contention-v10 --task-set=contention
 *   npm run salvage -- --run-id=run-b-faithful-contention-v10 --task-set=contention --coordination --coord-mode=faithful
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isBranchMergedInto,
  listTaskBranches,
} from "./lib/git.mjs";
import {
  createInitialProgress,
  loadProgress,
  progressPath,
  saveProgress,
} from "./lib/progress.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = {
    runId: null,
    taskSet: "default",
    coordination: false,
    coordMode: "strict",
    quick: false,
    serial: false,
    force: false,
  };
  for (const a of argv) {
    if (a.startsWith("--run-id=")) args.runId = a.split("=")[1];
    else if (a.startsWith("--task-set=")) args.taskSet = a.split("=")[1];
    else if (a === "--coordination") args.coordination = true;
    else if (a.startsWith("--coord-mode=")) args.coordMode = a.split("=")[1];
    else if (a === "--quick") args.quick = true;
    else if (a === "--serial") args.serial = true;
    else if (a === "--force") args.force = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node orchestrator/salvage-progress.mjs --run-id=ID [options]

Options:
  --run-id=ID          Required. Run directory under runs/
  --task-set=SET       default | contention (must match original run)
  --coordination       Coordination was on
  --coord-mode=MODE    strict | faithful
  --quick              Quick mode was on
  --serial             Serial mode was on
  --force              Overwrite existing progress.json
`);
      process.exit(0);
    }
  }
  return args;
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (!cli.runId) {
    console.error("Missing --run-id=ID");
    process.exit(1);
  }
  if (cli.coordMode === "faithful") cli.coordination = true;

  const runDir = path.join(ROOT, "runs", cli.runId);
  const workspaceDir = path.join(runDir, "workspace");
  const tasksPath = path.join(runDir, "tasks.json");

  if (!existsSync(runDir)) {
    console.error(`Run dir missing: ${runDir}`);
    process.exit(1);
  }
  if (!existsSync(workspaceDir)) {
    console.error(`Workspace missing: ${workspaceDir}`);
    process.exit(1);
  }
  if (!existsSync(tasksPath)) {
    console.error(`tasks.json missing — cannot salvage without task list: ${tasksPath}`);
    process.exit(1);
  }

  const existing = loadProgress(runDir);
  if (existing && !cli.force) {
    console.error(`progress.json already exists at ${progressPath(runDir)} (use --force to overwrite)`);
    process.exit(1);
  }

  const tasks = JSON.parse(readFileSync(tasksPath, "utf8"));
  if (!Array.isArray(tasks) || !tasks.length) {
    console.error("tasks.json is empty or invalid");
    process.exit(1);
  }

  const fingerprint = {
    task_set: cli.taskSet,
    coordination_mode: cli.coordination ? cli.coordMode : "none",
    quick: cli.quick,
    serial: cli.serial,
  };

  const progress = createInitialProgress({
    runId: cli.runId,
    fingerprint,
    tasks,
  });

  const branches = new Set(listTaskBranches(workspaceDir));
  for (const t of tasks) {
    const id = t.id;
    if (id === "task-01") {
      progress.tasks[id] = existsSync(path.join(runDir, "score-after-task-01.json"))
        ? "done"
        : "pending";
      continue;
    }
    const branch = `task/${id}`;
    if (branches.has(branch) && isBranchMergedInto(workspaceDir, branch, "main")) {
      progress.tasks[id] = "done";
    } else {
      progress.tasks[id] = "pending";
    }
  }

  const names = readdirSync(runDir);
  const hasMetrics = existsSync(path.join(runDir, "metrics.json"));
  const globalBefore = names.filter((n) => /^score-global-before-\d+\.json$/.test(n));
  const globalAfter = names.filter((n) => /^score-global-after-\d+\.json$/.test(n));

  if (hasMetrics) {
    progress.phase = "finished";
    progress.global_repair_rounds_done = globalAfter.length;
  } else if (globalBefore.length) {
    progress.phase = "global_repair";
    progress.global_repair_rounds_done = globalAfter.length;
  } else {
    progress.phase = "tasks";
    progress.global_repair_rounds_done = 0;
  }

  let startedAt = new Date().toISOString();
  try {
    startedAt = statSync(tasksPath).mtime.toISOString();
  } catch {
    /* keep now */
  }
  progress.segments = [{ started_at: startedAt, salvaged: true }];

  saveProgress(runDir, progress);

  console.log(`\n=== salvage ${cli.runId} ===`);
  console.log(`phase: ${progress.phase}`);
  console.log(`fingerprint: ${JSON.stringify(fingerprint)}`);
  console.log(`global_repair_rounds_done: ${progress.global_repair_rounds_done}`);
  console.log("tasks:");
  for (const t of tasks) {
    console.log(`  ${t.id}: ${progress.tasks[t.id]}`);
  }
  const done = Object.values(progress.tasks).filter((s) => s === "done").length;
  const pending = Object.values(progress.tasks).filter((s) => s !== "done").length;
  console.log(`summary: ${done} done, ${pending} pending/other`);
  console.log(`wrote ${progressPath(runDir)}\n`);
}

main();
