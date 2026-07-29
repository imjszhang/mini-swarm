#!/usr/bin/env node
/**
 * Score + finalize metrics for an interrupted swarm run without resuming.
 * Does NOT mutate the workspace beyond reading it for scoring.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig, projectRoot } from "./lib/config.mjs";
import { finalizeRun } from "./lib/finalize.mjs";
import { setActiveTaskPack } from "./lib/task-pack.mjs";
import { loadTree } from "./lib/tree.mjs";
import { createMetricsCollector, loadMetricsSeed } from "./metrics.mjs";

function parseArgs(argv) {
  const args = { runId: null, task: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--run-id") args.runId = argv[++i];
    else if (a.startsWith("--run-id=")) args.runId = a.slice("--run-id=".length);
    else if (a === "--task") args.task = argv[++i];
    else if (a.startsWith("--task=")) args.task = a.slice("--task=".length);
  }
  return args;
}

function usage() {
  console.log(`Usage: node orchestrator/finalize-swarm-run.mjs --run-id=ID
  Scores the workspace and writes finalized metrics.json (salvaged: true).
  Does not resume the swarm loop.`);
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help || !cli.runId) {
    usage();
    process.exit(cli.help ? 0 : 1);
  }

  const config = loadConfig();
  const runDir = path.join(projectRoot(), "runs", cli.runId);
  const workspaceDir = path.join(runDir, "workspace");
  if (!existsSync(workspaceDir)) {
    console.error(`[finalize] missing workspace: ${workspaceDir}`);
    process.exit(1);
  }

  const tree = loadTree(runDir);
  const seed = loadMetricsSeed(runDir);
  const taskId = cli.task || seed?.task_pack || "commonmark";
  setActiveTaskPack(taskId);
  const metrics = createMetricsCollector(runDir, { seed: seed || undefined, resume: false });
  metrics.setMeta({
    coordination: true,
    coordination_mode: "faithful-swarm",
    architecture: seed?.architecture || "v13.3-swarm",
    task_pack: taskId,
    swarm: true,
  });

  const result = finalizeRun({
    workspaceDir,
    runDir,
    metrics,
    tree,
    config,
    salvaged: true,
  });

  console.log(
    `[finalize] salvaged full=${(result.full.rate * 100).toFixed(1)}%`
      + ` visible=${(result.visible.rate * 100).toFixed(1)}%`
      + ` holdout=${(result.holdout.rate * 100).toFixed(1)}%`,
  );
  console.log(`[finalize] metrics=${result.metricsPath}`);
}

main().catch((err) => {
  console.error("[finalize] fatal:", err);
  process.exit(1);
});
