#!/usr/bin/env node
/**
 * Solo (single-agent) baseline entry.
 * Same task packs + hidden grader + metrics as swarm.mjs, but one agent,
 * one workspace, no planner tree / worktrees / merge.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, normalizeMaxTokensInOut, projectRoot, resolveModel } from "./lib/config.mjs";
import { finalizeRun } from "./lib/finalize.mjs";
import { commitAll, filesChangedSince, headSha } from "./lib/git.mjs";
import { ensureHoldout, holdoutFilePath } from "./lib/holdout.mjs";
import { extractJsonObject } from "./lib/json-parse.mjs";
import { buildSoloPrompt } from "./lib/prompts.mjs";
import { runEmbeddedSelfCheck } from "./lib/spec-embedded-check.mjs";
import { listSpecSections } from "./lib/spec-toc.mjs";
import {
  nextPerfectObserveStreak,
  nextUnproductiveStreak,
  shouldStopSolo,
  soloStopConsoleMessage,
} from "./lib/solo-stop-policy.mjs";
import { checkWorkspaceHealth, formatEngineeringError } from "./lib/swarm-health.mjs";
import { getActiveTaskPack, setActiveTaskPack } from "./lib/task-pack.mjs";
import { createEmptyTree, saveTree } from "./lib/tree.mjs";
import { examplesPath, scoreScope } from "./lib/verifier.mjs";
import { powershellCommand, taskkillPid } from "./lib/win-exec.mjs";
import { initSoloWorkspace } from "./lib/workspace.mjs";
import {
  activeWallMinutes,
  createMetricsCollector,
  loadMetricsSeed,
  totalTokensInOut,
} from "./metrics.mjs";
import { agentUsage, spawnAgent } from "./runner.mjs";

const SOLO_SCRIPT = fileURLToPath(import.meta.url);
const HEARTBEAT_STALE_MS = 2 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

function parseArgs(argv) {
  const args = {
    mock: false,
    runId: null,
    budgetMinutes: null,
    runToDone: false,
    maxWallMinutes: null,
    maxTokens: null,
    maxTurns: null,
    model: null,
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
    else if (a === "--model") args.model = argv[++i];
    else if (a.startsWith("--model=")) args.model = a.slice("--model=".length);
    else if (a === "--budget-minutes") args.budgetMinutes = Number(argv[++i]);
    else if (a.startsWith("--budget-minutes=")) args.budgetMinutes = Number(a.slice("--budget-minutes=".length));
    else if (a === "--max-wall-minutes") args.maxWallMinutes = Number(argv[++i]);
    else if (a.startsWith("--max-wall-minutes=")) args.maxWallMinutes = Number(a.slice("--max-wall-minutes=".length));
    else if (a === "--max-tokens") args.maxTokens = Number(argv[++i]);
    else if (a.startsWith("--max-tokens=")) args.maxTokens = Number(a.slice("--max-tokens=".length));
    else if (a === "--max-turns") args.maxTurns = Number(argv[++i]);
    else if (a.startsWith("--max-turns=")) args.maxTurns = Number(a.slice("--max-turns=".length));
  }
  return args;
}

function usage() {
  console.log(`Usage: node orchestrator/solo.mjs [options]
  --run-id=ID
  --task=commonmark|toml-json|sqlite-micro   Task pack (default commonmark)
  --model=SLUG         Override models.solo
  --budget-minutes=N   Wall-clock budget when not --run-to-done (default config.solo.budgetMinutes)
  --run-to-done        Run until agent done / observe_perfect (hard stop: maxWallMinutes)
  --max-wall-minutes=N Hard safety stop for --run-to-done (default config.solo.maxWallMinutes)
  --max-tokens=N       Optional hard stop on sum(tokens_in+tokens_out); default unlimited
  --max-turns=N        Safety cap on turn count (default config.solo.maxTurns)
  --detach             Respawn as a detached process (console.log + solo.pid); exit parent
  --resume             Resume an interrupted run (requires --run-id)
  --mock               Scripted turns; no LLM
  --help`);
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

function detachSelf(runId, runDir) {
  mkdirSync(runDir, { recursive: true });
  const consolePath = path.join(runDir, "console.log");
  const fd = openSync(consolePath, "a");
  const childArgs = [SOLO_SCRIPT];
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
    cwd: projectRoot(),
    env: process.env,
    windowsHide: true,
  });
  writeFileSync(path.join(runDir, "solo.pid"), `${child.pid}\n`, "utf8");
  child.unref();
  console.log(`[solo] detached pid=${child.pid} run-id=${runId}`);
  console.log(`[solo] monitor: ${consolePath}`);
  console.log(`[solo] heartbeat: ${path.join(runDir, "heartbeat.json")}`);
  process.exit(0);
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

function formatBudgetLine(solo, startedAtMs, hardDeadlineMs, metricsData) {
  const elapsed = ((Date.now() - startedAtMs) / 60000).toFixed(1);
  const remaining = Math.max(0, (hardDeadlineMs - Date.now()) / 60000).toFixed(1);
  const tokens = totalTokensInOut(metricsData);
  const cap = normalizeMaxTokensInOut(solo.maxTokensInOut);
  const tokenPart = cap == null ? `tokens=${tokens}` : `tokens=${tokens}/${cap}`;
  return `elapsed=${elapsed}m remaining≈${remaining}m ${tokenPart} runToDone=${!!solo.runToDone}`;
}

function createSoloTreeStub(turnCount = 0, done = false) {
  const tree = createEmptyTree();
  tree.planner_rounds = turnCount;
  tree.done = !!done;
  tree.nodes["leaf-01"] = {
    id: "leaf-01",
    kind: "leaf",
    title: "solo-implementation",
    status: done ? "done" : "pending",
    parent: null,
    deps: [],
    attempts: turnCount,
  };
  tree.next_id = 2;
  return tree;
}

function parseAgentReport(output) {
  const parsed = extractJsonObject(output);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "continue", summary: "(unparsed agent output)", self_checked: 0, raw: true };
  }
  const status = String(parsed.status || "continue").toLowerCase();
  const normalized = ["continue", "done", "blocked"].includes(status) ? status : "continue";
  return {
    status: normalized,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    self_checked: Number(parsed.self_checked) || 0,
    raw: false,
  };
}

function mockTurn(workspaceDir, turnIndex) {
  // Scripted progress: annotate README then declare done on turn 2.
  const notePath = path.join(workspaceDir, "SOLO_MOCK.md");
  writeFileSync(notePath, `# mock turn ${turnIndex}\n`, "utf8");
  commitAll(workspaceDir, `mock: solo turn ${turnIndex}`);
  if (turnIndex >= 2) {
    return {
      ok: true,
      output: JSON.stringify({ status: "done", summary: "mock complete", self_checked: 0 }),
      usage: { input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0 },
      apiMs: 1,
      elapsedMs: 5,
      model: "mock",
      timedOut: false,
      code: 0,
    };
  }
  return {
    ok: true,
    output: JSON.stringify({ status: "continue", summary: `mock turn ${turnIndex}`, self_checked: 0 }),
    usage: { input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0 },
    apiMs: 1,
    elapsedMs: 5,
    model: "mock",
    timedOut: false,
    code: 0,
  };
}

function formatFeedback({ health, embedded, report, hadDiff }) {
  const lines = [];
  if (report?.summary) lines.push(`Previous agent summary: ${report.summary}`);
  lines.push(`Previous status: ${report?.status || "n/a"}; files_changed=${hadDiff ? "yes" : "no"}`);
  if (health?.ok) lines.push("Build/canary: OK");
  else if (health) {
    lines.push(formatEngineeringError({
      phase: "post-turn",
      kind: health.kind || "build",
      stderr: health.stderr || "",
    }));
  }
  if (embedded?.ok) {
    lines.push(`Spec-embedded self-check: OK (${embedded.checked || 0} examples)`);
  } else if (embedded && !embedded.skipped) {
    lines.push(formatEngineeringError({
      phase: "post-turn",
      kind: "embedded",
      stderr: embedded.stderr || embedded.message || "embedded self-check failed",
    }));
  }
  lines.push("Suite scores are not available to you. Keep improving against SPEC.txt embedded examples.");
  return lines.join("\n");
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    usage();
    process.exit(0);
  }
  if (cli.resume && !cli.runId) {
    console.error("[solo] --resume requires --run-id");
    process.exit(1);
  }

  let taskPack;
  try {
    taskPack = setActiveTaskPack(cli.task || "commonmark");
  } catch (err) {
    console.error(`[solo] ${err.message || err}`);
    process.exit(1);
  }

  const config = loadConfig();
  if (cli.model) {
    config.models = { ...config.models, solo: cli.model };
  }
  if (cli.budgetMinutes != null && !Number.isNaN(cli.budgetMinutes)) {
    config.solo.budgetMinutes = cli.budgetMinutes;
  }
  if (cli.runToDone) config.solo.runToDone = true;
  if (cli.maxWallMinutes != null && !Number.isNaN(cli.maxWallMinutes)) {
    config.solo.maxWallMinutes = cli.maxWallMinutes;
  }
  if (cli.maxTokens != null && !Number.isNaN(cli.maxTokens)) {
    config.solo.maxTokensInOut = normalizeMaxTokensInOut(cli.maxTokens);
  }
  if (cli.maxTurns != null && !Number.isNaN(cli.maxTurns)) {
    config.solo.maxTurns = Math.max(1, Math.floor(cli.maxTurns));
  }

  const solo = config.solo;
  const runId = cli.runId || `solo-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = path.join(projectRoot(), "runs", runId);

  if (cli.detach) {
    detachSelf(runId, runDir);
    return;
  }

  const workspaceDir = path.join(runDir, "workspace");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "solo.pid"), `${process.pid}\n`, "utf8");

  let metrics;
  let startedAtMs;
  let hardDeadlineMs;
  let turnIndex = 0;
  let feedback = "_None yet (first turn)._";
  let perfectObserveStreak = 0;
  let unproductiveStreak = 0;

  if (cli.resume) {
    if (!existsSync(workspaceDir)) {
      console.error(`[solo] cannot resume: missing workspace in ${runDir}`);
      process.exit(1);
    }
    if (isHeartbeatFresh(runDir)) {
      console.error("[solo] refuse --resume: heartbeat.json updated within 2 minutes (process may still be alive)");
      process.exit(1);
    }
    console.log(`[solo] resume cleanup for ${runId}`);
    const orphans = killOrphanAgents(runDir);
    if (orphans.killed.length) console.log(`[solo] killed orphan pids: ${orphans.killed.join(", ")}`);

    const seed = loadMetricsSeed(runDir);
    metrics = createMetricsCollector(runDir, { seed: seed || undefined, resume: true });
    turnIndex = Number(seed?.solo_turns) || 0;
    perfectObserveStreak = Number(seed?.perfect_observe_streak) || 0;
    unproductiveStreak = Number(seed?.unproductive_streak) || 0;
    feedback = typeof seed?.solo_last_feedback === "string"
      ? seed.solo_last_feedback
      : "_Resumed; continue from current workspace._";
    const consumed = activeWallMinutes(metrics.data);
    const budgetMin = solo.runToDone ? solo.maxWallMinutes : solo.budgetMinutes;
    const remaining = Math.max(5, budgetMin - consumed);
    startedAtMs = Date.now();
    hardDeadlineMs = startedAtMs + remaining * 60 * 1000;
    ensureHoldout(runDir, examplesPath(), config);
  } else {
    metrics = createMetricsCollector(runDir);
    startedAtMs = Date.now();
    hardDeadlineMs = startedAtMs
      + (solo.runToDone ? solo.maxWallMinutes : solo.budgetMinutes) * 60 * 1000;
    initSoloWorkspace(workspaceDir, { mock: cli.mock, pack: taskPack });
    ensureHoldout(runDir, examplesPath(), config);
  }

  metrics.setMeta({
    coordination: false,
    coordination_mode: "solo",
    planner_source: cli.mock ? "mock-solo" : "solo",
    task_set: "solo",
    task_pack: taskPack.id,
    swarm: false,
    architecture: "solo-v1",
    run_to_done: !!solo.runToDone,
    resumed: !!cli.resume,
    solo: {
      concurrency: 1,
      maxTurns: solo.maxTurns,
      turnTimeoutMinutes: solo.turnTimeoutMinutes,
    },
  });

  const tokenCapLog = normalizeMaxTokensInOut(solo.maxTokensInOut);
  console.log(
    `[solo] id=${runId} task=${taskPack.id} mock=${cli.mock} resume=${cli.resume} runToDone=${solo.runToDone}`
      + ` hardStop=${solo.runToDone ? solo.maxWallMinutes : solo.budgetMinutes}m`
      + ` maxTokens=${tokenCapLog == null ? "none" : tokenCapLog}`
      + ` maxTurns=${solo.maxTurns}`,
  );
  console.log(`[solo] model=${resolveModel(config, "solo")}`);

  const heartbeatTimer = setInterval(() => {
    writeHeartbeat(runDir, {
      at: new Date().toISOString(),
      pid: process.pid,
      turn: turnIndex,
      run_id: runId,
    });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();
  writeHeartbeat(runDir, { at: new Date().toISOString(), pid: process.pid, turn: turnIndex, run_id: runId });

  let stopReason = null;
  const sections = listSpecSections();

  try {
    while (!stopReason) {
      if (Date.now() >= hardDeadlineMs) {
        stopReason = "wall_budget";
        break;
      }
      const tokenCap = normalizeMaxTokensInOut(solo.maxTokensInOut);
      if (tokenCap != null && totalTokensInOut(metrics.data) >= tokenCap) {
        stopReason = "token_budget";
        break;
      }
      if (turnIndex >= solo.maxTurns) {
        stopReason = "max_turns";
        break;
      }

      turnIndex += 1;
      const shaBefore = headSha(workspaceDir);
      const budgetLine = formatBudgetLine(solo, startedAtMs, hardDeadlineMs, metrics.data);
      const prompt = buildSoloPrompt({
        goalLabel: taskPack.goalLabel,
        turnIndex,
        budgetLine,
        feedback,
        promptsDir: taskPack.promptsDir,
      });

      console.log(`[solo] turn ${turnIndex}/${solo.maxTurns} ${budgetLine}`);

      let result;
      if (cli.mock) {
        result = mockTurn(workspaceDir, turnIndex);
      } else {
        result = await spawnAgent({
          role: "solo",
          prompt,
          cwd: workspaceDir,
          config,
          runDir,
          logKey: `solo-turn-${String(turnIndex).padStart(3, "0")}`,
          timeoutMs: (solo.turnTimeoutMinutes || 30) * 60 * 1000,
        });
        // Agent may have left uncommitted work; capture it.
        commitAll(workspaceDir, `solo: turn ${turnIndex}`);
      }

      metrics.recordAgentCall({
        role: "solo",
        taskId: `turn-${turnIndex}`,
        ok: result.ok,
        timedOut: !!result.timedOut,
        ...agentUsage(result),
      });

      const changed = filesChangedSince(workspaceDir, shaBefore);
      const hadDiff = changed.length > 0;
      const report = parseAgentReport(result.output);

      const health = checkWorkspaceHealth(workspaceDir, taskPack);
      let embedded = { ok: true, checked: 0, skipped: true };
      // Mock skeleton cannot satisfy embedded examples; skip so wiring can finalize.
      if (health.ok && !cli.mock) {
        embedded = runEmbeddedSelfCheck({
          workspaceDir,
          sections,
          maxExamples: solo.harnessSelfCheckExamples,
          pack: taskPack,
          seed: `solo-${runId}-t${turnIndex}`,
        });
        if (embedded.checked) {
          metrics.data.self_check_total = (metrics.data.self_check_total || 0) + (embedded.checked || 0);
          metrics.data.harness_self_check = (metrics.data.harness_self_check || 0) + (embedded.checked || 0);
        }
      }

      const healthOk = !!(health.ok && (embedded.ok || embedded.skipped || cli.mock));
      const observe = observeScore({
        workspaceDir,
        runDir,
        metrics,
        label: `t${turnIndex}`,
      });
      perfectObserveStreak = nextPerfectObserveStreak(perfectObserveStreak, observe);
      unproductiveStreak = nextUnproductiveStreak(unproductiveStreak, hadDiff);

      feedback = formatFeedback({ health, embedded, report, hadDiff });
      metrics.data.solo_turns = turnIndex;
      metrics.data.perfect_observe_streak = perfectObserveStreak;
      metrics.data.unproductive_streak = unproductiveStreak;
      metrics.data.solo_last_feedback = feedback;
      metrics.data.solo_last_status = report.status;

      metrics.recordTask({
        id: `turn-${turnIndex}`,
        status: report.status === "done" && healthOk ? "done" : "running",
        elapsedMs: result.elapsedMs,
        started_at: new Date(Date.now() - (result.elapsedMs || 0)).toISOString(),
        files_changed: changed.length,
        agent_status: report.status,
        health_ok: healthOk,
      });

      const tree = createSoloTreeStub(turnIndex, false);
      saveTree(runDir, tree);
      metrics.checkpoint({
        solo_turns: turnIndex,
        perfect_observe_streak: perfectObserveStreak,
        unproductive_streak: unproductiveStreak,
      });
      writeHeartbeat(runDir, {
        at: new Date().toISOString(),
        pid: process.pid,
        turn: turnIndex,
        run_id: runId,
        observe_rate: observe?.rate ?? null,
      });

      const decision = shouldStopSolo({
        wallBudgetExhausted: Date.now() >= hardDeadlineMs,
        tokenBudgetExhausted: tokenCap != null && totalTokensInOut(metrics.data) >= tokenCap,
        turnIndex,
        maxTurns: solo.maxTurns,
        agentStatus: report.status,
        healthOk,
        perfectObserveStreak,
        observePerfectStreakToStop: solo.observePerfectStreakToStop,
        unproductiveStreak,
        maxUnproductiveTurns: solo.maxUnproductiveTurns,
        treatBlockedAsStop: false,
      });
      if (decision.stop) {
        stopReason = decision.reason;
        break;
      }
    }

    if (!stopReason) stopReason = "max_turns";
    metrics.data.stop_reason = stopReason;
    metrics.data.solo_turns = turnIndex;
    console.log(soloStopConsoleMessage(stopReason));

    const done = stopReason === "agent_done" || stopReason === "observe_perfect";
    const tree = createSoloTreeStub(turnIndex, done);
    if (done) {
      tree.nodes["leaf-01"].status = "done";
    } else if (stopReason === "agent_blocked") {
      tree.nodes["leaf-01"].status = "blocked";
    } else {
      tree.nodes["leaf-01"].status = "failed";
    }
    saveTree(runDir, tree);

    const result = finalizeRun({
      workspaceDir,
      runDir,
      metrics,
      tree,
      config,
      salvaged: false,
    });

    console.log(
      `[solo] finished stop=${stopReason} full=${(result.full.rate * 100).toFixed(1)}%`
        + ` visible=${(result.visible.rate * 100).toFixed(1)}%`
        + ` holdout=${(result.holdout.rate * 100).toFixed(1)}%`
        + ` turns=${turnIndex}`,
    );
    console.log(`[solo] metrics=${result.metricsPath}`);
  } finally {
    clearInterval(heartbeatTimer);
  }
}

main().catch((err) => {
  console.error("[solo] fatal:", err);
  process.exit(1);
});
