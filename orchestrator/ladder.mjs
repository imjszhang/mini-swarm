#!/usr/bin/env node
/**
 * Solo → swarm ladder driver (v13.6).
 * Process composition only: spawns solo.mjs then optionally swarm.mjs with --seed-workspace.
 * Does not import solo/swarm internal loops.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, projectRoot } from "./lib/config.mjs";
import { ladderDecision, shouldSkipL0 } from "./lib/ladder-policy.mjs";
import { resolveTaskPack } from "./lib/task-pack.mjs";
import { totalTokensInOut } from "./metrics.mjs";

const LADDER_SCRIPT = fileURLToPath(import.meta.url);
const ROOT = projectRoot();

function parseArgs(argv) {
  const args = {
    mock: false,
    runId: null,
    task: "commonmark",
    maxTokens: null,
    detach: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--mock") args.mock = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--detach") args.detach = true;
    else if (a === "--run-id") args.runId = argv[++i];
    else if (a.startsWith("--run-id=")) args.runId = a.slice("--run-id=".length);
    else if (a === "--task") args.task = argv[++i];
    else if (a.startsWith("--task=")) args.task = a.slice("--task=".length);
    else if (a === "--max-tokens") args.maxTokens = Number(argv[++i]);
    else if (a.startsWith("--max-tokens=")) args.maxTokens = Number(a.slice("--max-tokens=".length));
  }
  return args;
}

function usage() {
  console.log(`Usage: node orchestrator/ladder.mjs [options]
  --run-id=ID
  --task=commonmark|toml-json|sqlite-micro   Task pack (default commonmark)
  --max-tokens=N       Shared token budget across L0 + escalate (optional)
  --detach             Respawn as a detached process (console.log + ladder.pid)
  --mock               Scripted solo then escalate to swarm mock
  --help`);
}

function detachSelf(runId, runDir) {
  mkdirSync(runDir, { recursive: true });
  const consolePath = path.join(runDir, "console.log");
  const fd = openSync(consolePath, "a");
  const childArgs = [LADDER_SCRIPT];
  const raw = process.argv.slice(2).filter((a) => a !== "--detach");
  let hasRunId = false;
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === "--run-id" || raw[i].startsWith("--run-id=")) hasRunId = true;
  }
  if (!hasRunId) raw.push(`--run-id=${runId}`);
  childArgs.push(...raw);

  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: ["ignore", fd, fd],
    cwd: ROOT,
    env: process.env,
    windowsHide: true,
  });
  writeFileSync(path.join(runDir, "ladder.pid"), `${child.pid}\n`, "utf8");
  child.unref();
  console.log(`[ladder] detached pid=${child.pid} run-id=${runId}`);
  console.log(`[ladder] monitor: ${consolePath}`);
  process.exit(0);
}

function runNode(scriptRel, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, scriptRel), ...args], {
      stdio: "inherit",
      cwd: ROOT,
      env: process.env,
      windowsHide: true,
    });
    child.on("exit", (code, signal) => {
      resolve({ code: code == null ? 1 : code, signal });
    });
    child.on("error", (err) => {
      console.error(`[ladder] spawn failed: ${err.message || err}`);
      resolve({ code: 1, signal: null });
    });
  });
}

function readMetrics(runDir) {
  const p = path.join(runDir, "metrics.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeLadderJson(runDir, payload) {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    path.join(runDir, "ladder.json"),
    `${JSON.stringify({ ...payload, at: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

function specCharCount(taskPack) {
  try {
    return readFileSync(taskPack.specTextPath, "utf8").length;
  } catch {
    return 0;
  }
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    usage();
    return;
  }

  const config = loadConfig();
  const ladder = config.ladder;
  const taskPack = resolveTaskPack(cli.task);
  const runId = cli.runId || `run-ladder-${Date.now()}`;
  const runDir = path.join(ROOT, "runs", runId);
  const l0RunId = `${runId}-l0`;
  const l0RunDir = path.join(ROOT, "runs", l0RunId);

  if (cli.detach) {
    detachSelf(runId, runDir);
    return;
  }

  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "ladder.pid"), `${process.pid}\n`, "utf8");

  const skipL0 = shouldSkipL0({
    specChars: specCharCount(taskPack),
    specCharsSkipL0: ladder.specCharsSkipL0,
  });

  let l0Metrics = null;
  if (!skipL0) {
    const soloArgs = [
      `--task=${taskPack.id}`,
      `--run-id=${l0RunId}`,
      "--run-to-done",
      `--max-wall-minutes=${ladder.l0MaxMinutes}`,
    ];
    if (cli.mock) soloArgs.push("--mock", "--max-turns=3");
    if (cli.maxTokens != null && !Number.isNaN(cli.maxTokens)) {
      soloArgs.push(`--max-tokens=${cli.maxTokens}`);
    }
    console.log(`[ladder] L0 solo: ${soloArgs.join(" ")}`);
    const soloExit = await runNode("orchestrator/solo.mjs", soloArgs);
    l0Metrics = readMetrics(l0RunDir);
    if (soloExit.code !== 0) {
      console.warn(`[ladder] L0 solo exited ${soloExit.code}; treating as escalate candidate`);
    }
  } else {
    console.log("[ladder] skipping L0 (specCharsSkipL0 threshold)");
  }

  const decision = skipL0
    ? { escalate: true, reason: "skip_l0" }
    : ladderDecision({ metricsData: l0Metrics, targetObserve: ladder.l0TargetObserve });

  writeLadderJson(l0RunDir, {
    level_terminal: decision.escalate ? "L0" : "L0",
    escalated: decision.escalate,
    reason: decision.reason,
    l0_run_id: l0RunId,
    swarm_run_id: decision.escalate ? runId : null,
  });

  if (!decision.escalate) {
    writeLadderJson(runDir, {
      level_terminal: "L0",
      escalated: false,
      reason: decision.reason,
      l0_run_id: l0RunId,
      swarm_run_id: null,
    });
    console.log(`[ladder] terminate at L0 (${decision.reason})`);
    process.exit(0);
  }

  let remainingTokens = null;
  if (cli.maxTokens != null && !Number.isNaN(cli.maxTokens)) {
    const used = totalTokensInOut(l0Metrics || {});
    remainingTokens = Math.max(0, Math.floor(cli.maxTokens) - used);
    if (remainingTokens === 0) {
      writeLadderJson(runDir, {
        level_terminal: "L0",
        escalated: false,
        reason: "token_budget_exhausted_at_l0",
        l0_run_id: l0RunId,
        swarm_run_id: null,
      });
      console.log("[ladder] token budget exhausted at L0; not escalating");
      process.exit(0);
    }
  }

  const seedWorkspace = path.join(l0RunDir, "workspace");
  if (!skipL0 && !existsSync(seedWorkspace)) {
    console.error(`[ladder] cannot escalate: missing seed workspace ${seedWorkspace}`);
    writeLadderJson(runDir, {
      level_terminal: "L0",
      escalated: false,
      reason: "missing_seed_workspace",
      l0_run_id: l0RunId,
      swarm_run_id: null,
    });
    process.exit(1);
  }

  const swarmArgs = [
    `--task=${taskPack.id}`,
    `--run-id=${runId}`,
    "--run-to-done",
  ];
  if (!skipL0) swarmArgs.push(`--seed-workspace=${seedWorkspace}`);
  if (cli.mock) swarmArgs.push("--mock");
  if (remainingTokens != null) swarmArgs.push(`--max-tokens=${remainingTokens}`);

  console.log(`[ladder] escalate → swarm: ${swarmArgs.join(" ")}`);
  const swarmExit = await runNode("orchestrator/swarm.mjs", swarmArgs);

  writeLadderJson(runDir, {
    level_terminal: "swarm",
    escalated: true,
    reason: decision.reason,
    l0_run_id: l0RunId,
    swarm_run_id: runId,
  });
  writeLadderJson(l0RunDir, {
    level_terminal: "L0",
    escalated: true,
    reason: decision.reason,
    l0_run_id: l0RunId,
    swarm_run_id: runId,
  });

  process.exit(swarmExit.code);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
