/**
 * v11 repair engine: ledger + adjudication + adaptive clustering +
 * monotonic changeset acceptance + best-of-N candidate search.
 *
 * Mechanism code: no task-specific vocabulary beyond opaque "group" labels
 * coming from the verifier facade.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  abortMerge,
  commitAll,
  createWorktree,
  deleteBranchesByPrefix,
  findConflictMarkers,
  headSha,
  listTrackedFiles,
  mergeBranchNoFf,
  removeWorktree,
  resetHard,
} from "./lib/git.mjs";
import { extractJsonObject } from "./lib/json-parse.mjs";
import {
  applyVerdicts,
  itemsNeedingAdjudication,
  loadLedger,
  repairableFailingIds,
  routedOutSummary,
  saveLedger,
  updateFromReport,
} from "./lib/ledger.mjs";
import { markRepairRound } from "./lib/progress.mjs";
import {
  buildAdjudicatePrompt,
  buildClusterPrompt,
  buildRepairClusterPrompt,
} from "./lib/prompts.mjs";
import { projectRoot } from "./lib/config.mjs";
import { getReferenceText, scoreScope } from "./lib/verifier.mjs";
import { holdoutFilePath } from "./lib/holdout.mjs";
import { spawnAgent } from "./runner.mjs";

function buildVerifyCmd(itemIds, holdoutFile) {
  const scorer = path.join(projectRoot(), "scorer", "score.mjs");
  const parts = [
    `node ${JSON.stringify(scorer)}`,
    "--workspace .",
    `--ids ${itemIds.join(",")}`,
  ];
  if (holdoutFile) {
    parts.push(`--holdout-file ${JSON.stringify(holdoutFile)}`, "--holdout-mode exclude");
  }
  return parts.join(" ");
}

function pickWorstGroups(byGroup, topN) {
  return Object.entries(byGroup || {})
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

function failingIdSet(report) {
  return new Set((report.failures || []).map((f) => f.id));
}

/**
 * Accept when build ok, passed count did not drop, and no previously-passing
 * item became failing.
 */
function acceptsChangeset(before, after) {
  if ((after.passed || 0) < (before.passed || 0)) return false;
  const beforeFail = failingIdSet(before);
  const afterFail = failingIdSet(after);
  for (const id of afterFail) {
    if (!beforeFail.has(id)) return false; // regression of a previously-passing item
  }
  return true;
}

async function parseAgentJson(result, retryFn) {
  let parsed = extractJsonObject(result.stdout || "");
  if (parsed) return parsed;
  if (retryFn) {
    const retry = await retryFn();
    parsed = extractJsonObject(retry.stdout || "");
    if (parsed) return parsed;
  }
  return null;
}

async function runAdjudication({
  workspaceDir,
  config,
  runDir,
  metrics,
  ledger,
  report,
}) {
  const threshold = config.repair?.stuckThreshold ?? 2;
  const stuck = itemsNeedingAdjudication(ledger, threshold).slice(0, 20);
  if (!stuck.length) return;

  const dossiers = stuck.map((item) => {
    const f = (report.failures || []).find((x) => x.id === item.id) || {};
    return {
      id: item.id,
      group: item.group || f.group,
      input: f.input,
      expected: f.expected,
      actual: f.actual,
      reference: getReferenceText(item.group || f.group),
    };
  });

  const prompt = buildAdjudicatePrompt({ items: dossiers });
  const spawnOnce = () => spawnAgent({
    role: "worker",
    prompt,
    cwd: workspaceDir,
    config,
    runDir,
    logKey: `adjudicate-${Date.now()}`,
    timeoutMs: (config.taskTimeoutMinutes || 20) * 60 * 1000,
  });

  const result = await spawnOnce();
  metrics.recordAgentCall({
    role: "adjudicator",
    ok: result.ok,
    elapsedMs: result.elapsedMs,
  });

  let parsed = await parseAgentJson(result, async () => {
    const retry = await spawnOnce();
    metrics.recordAgentCall({
      role: "adjudicator",
      ok: retry.ok,
      elapsedMs: retry.elapsedMs,
      retry: true,
    });
    return retry;
  });

  const allowed = new Set([
    "implementation_bug",
    "suspected_oracle_bug",
    "spec_ambiguity",
    "out_of_scope_dependency",
  ]);

  let verdicts = [];
  if (parsed?.verdicts && Array.isArray(parsed.verdicts)) {
    verdicts = parsed.verdicts
      .filter((v) => v?.id && allowed.has(v.class))
      .map((v) => ({ id: v.id, class: v.class, rationale: String(v.rationale || "") }));
  } else {
    metrics.data.adjudication_parse_failures = (metrics.data.adjudication_parse_failures || 0) + 1;
    verdicts = stuck.map((s) => ({
      id: s.id,
      class: "implementation_bug",
      rationale: "parse_fallback",
    }));
  }

  applyVerdicts(ledger, verdicts);
  for (const v of verdicts) {
    metrics.data.adjudications.push({ ...v, at: new Date().toISOString() });
  }

  const routed = routedOutSummary(ledger);
  metrics.data.suspected_oracle_bugs = routed.suspected;
  metrics.data.spec_ambiguities = routed.ambiguities;
  metrics.data.unowned_requirements = routed.unowned;
  saveLedger(runDir, ledger);
}

async function buildClusters({
  workspaceDir,
  config,
  runDir,
  metrics,
  report,
  repairableIds,
}) {
  const repairCfg = config.repair || {};
  const threshold = repairCfg.exhaustiveThreshold ?? 24;
  const maxClusters = repairCfg.maxClusters ?? 8;
  const topGroups = repairCfg.topGroups ?? 3;

  const failing = (report.failures || []).filter((f) => repairableIds.includes(f.id));

  if (failing.length === 0) return [];

  if (failing.length > threshold) {
    const worst = pickWorstGroups(report.by_group || report.by_section, topGroups);
    return worst.map((g, i) => ({
      cluster_id: `group-${i + 1}`,
      hypothesis: `Worst group: ${g.name}`,
      item_ids: failing.filter((f) => f.group === g.name).map((f) => f.id),
    })).filter((c) => c.item_ids.length);
  }

  const prompt = buildClusterPrompt({
    failures: failing,
    maxClusters,
  });
  const spawnOnce = () => spawnAgent({
    role: "worker",
    prompt,
    cwd: workspaceDir,
    config,
    runDir,
    logKey: `cluster-${Date.now()}`,
    timeoutMs: (config.taskTimeoutMinutes || 20) * 60 * 1000,
  });

  const result = await spawnOnce();
  metrics.recordAgentCall({
    role: "cluster",
    ok: result.ok,
    elapsedMs: result.elapsedMs,
  });

  let parsed = await parseAgentJson(result, async () => {
    const retry = await spawnOnce();
    metrics.recordAgentCall({
      role: "cluster",
      ok: retry.ok,
      elapsedMs: retry.elapsedMs,
      retry: true,
    });
    return retry;
  });

  if (parsed?.clusters && Array.isArray(parsed.clusters)) {
    const idSet = new Set(failing.map((f) => f.id));
    const clusters = [];
    const used = new Set();
    for (const c of parsed.clusters.slice(0, maxClusters)) {
      const ids = (c.item_ids || []).filter((id) => idSet.has(id) && !used.has(id));
      for (const id of ids) used.add(id);
      if (ids.length) {
        clusters.push({
          cluster_id: String(c.cluster_id || `c${clusters.length + 1}`),
          hypothesis: String(c.hypothesis || "unspecified"),
          item_ids: ids,
        });
      }
    }
    const leftover = failing.filter((f) => !used.has(f.id)).map((f) => f.id);
    if (leftover.length) {
      clusters.push({
        cluster_id: "leftover",
        hypothesis: "Unassigned failures",
        item_ids: leftover,
      });
    }
    if (clusters.length) return clusters;
  }

  // Fallback: one cluster per group
  metrics.data.adjudication_parse_failures = metrics.data.adjudication_parse_failures; // no-op keep field
  const byG = new Map();
  for (const f of failing) {
    const g = f.group || "default";
    if (!byG.has(g)) byG.set(g, []);
    byG.get(g).push(f.id);
  }
  return [...byG.entries()].map(([g, ids], i) => ({
    cluster_id: `fb-${i + 1}`,
    hypothesis: `Group fallback: ${g}`,
    item_ids: ids,
  }));
}

function scoreVisible(workspaceDir, jsonOut, holdoutFile) {
  return scoreScope(workspaceDir, jsonOut, {
    holdoutFile,
    holdoutMode: holdoutFile ? "exclude" : "include",
    truncate: 2000,
    maxFailures: 600,
  });
}

async function tryRung1({
  workspaceDir,
  config,
  runDir,
  coordMode,
  metrics,
  cluster,
  beforeReport,
  holdoutFile,
  ensureBuilt,
}) {
  const started = Date.now();
  commitAll(workspaceDir, `checkpoint: pre-repair ${cluster.cluster_id}`);
  const checkpointSha = headSha(workspaceDir);

  const failures = (beforeReport.failures || []).filter((f) => cluster.item_ids.includes(f.id));
  const groups = [...new Set(failures.map((f) => f.group).filter(Boolean))];
  const reference = groups.map((g) => getReferenceText(g)).filter(Boolean).join("\n\n---\n\n");
  const verifyCmd = buildVerifyCmd(cluster.item_ids, holdoutFile);

  const prompt = buildRepairClusterPrompt({
    rate: beforeReport.rate,
    clusterId: cluster.cluster_id,
    hypothesis: cluster.hypothesis,
    failures,
    reference,
    verifyCmd,
    coordMode,
  });

  const safeKey = String(cluster.cluster_id).replace(/[^\w.-]+/g, "_");
  const result = await spawnAgent({
    role: "worker",
    prompt,
    cwd: workspaceDir,
    config,
    runDir,
    logKey: `repair-${safeKey}`,
    timeoutMs: (config.taskTimeoutMinutes || 20) * 60 * 1000,
  });
  metrics.recordAgentCall({
    role: "repair",
    cluster_id: cluster.cluster_id,
    ok: result.ok,
    elapsedMs: result.elapsedMs,
  });
  commitAll(workspaceDir, `repair ${cluster.cluster_id}`);

  const build = ensureBuilt(workspaceDir);
  if (!build.ok) {
    resetHard(workspaceDir, checkpointSha);
    return {
      accepted: false,
      after: beforeReport,
      gain: 0,
      elapsedMs: Date.now() - started,
      rung: 1,
    };
  }

  const afterPath = path.join(runDir, `score-repair-${safeKey}-rung1.json`);
  const after = scoreVisible(workspaceDir, afterPath, holdoutFile).report;
  if (!acceptsChangeset(beforeReport, after)) {
    resetHard(workspaceDir, checkpointSha);
    return {
      accepted: false,
      after: beforeReport,
      gain: 0,
      elapsedMs: Date.now() - started,
      rung: 1,
    };
  }
  return {
    accepted: true,
    after,
    gain: (after.passed || 0) - (beforeReport.passed || 0),
    elapsedMs: Date.now() - started,
    rung: 1,
  };
}

async function tryRung2({
  workspaceDir,
  config,
  runDir,
  coordMode,
  metrics,
  cluster,
  beforeReport,
  holdoutFile,
  ensureBuilt,
}) {
  const started = Date.now();
  const n = config.repair?.candidates ?? 2;
  const worktreesRoot = path.join(runDir, "worktrees-repair");
  mkdirSync(worktreesRoot, { recursive: true });

  const failures = (beforeReport.failures || []).filter((f) => cluster.item_ids.includes(f.id));
  const groups = [...new Set(failures.map((f) => f.group).filter(Boolean))];
  const reference = groups.map((g) => getReferenceText(g)).filter(Boolean).join("\n\n---\n\n");
  const verifyCmd = buildVerifyCmd(cluster.item_ids, holdoutFile);
  const safeKey = String(cluster.cluster_id).replace(/[^\w.-]+/g, "_");

  const strategies = [
    "Strategy: prefer the smallest local fix that makes the listed examples pass.",
    "Strategy: prefer fixing the shared root cause even if it requires a wider refactor of the implicated modules.",
  ];

  commitAll(workspaceDir, `checkpoint: pre-rung2 ${cluster.cluster_id}`);
  const checkpointSha = headSha(workspaceDir);

  const candidates = [];
  for (let k = 0; k < n; k += 1) {
    const dirName = `${safeKey}-cand${k + 1}`;
    const branch = `repair/${safeKey}-cand${k + 1}`;
    let wt;
    try {
      wt = createWorktree(workspaceDir, worktreesRoot, dirName, { branch, dirName });
    } catch (err) {
      console.warn(`[repair] candidate worktree failed: ${err.message}`);
      continue;
    }

    const prompt = `${buildRepairClusterPrompt({
      rate: beforeReport.rate,
      clusterId: cluster.cluster_id,
      hypothesis: cluster.hypothesis,
      failures,
      reference,
      verifyCmd,
      coordMode,
    })}

## Candidate strategy

${strategies[k] || strategies[0]}
`;

    const result = await spawnAgent({
      role: "worker",
      prompt,
      cwd: wt.path,
      config,
      runDir,
      logKey: `repair-cand-${safeKey}-${k + 1}`,
      timeoutMs: (config.taskTimeoutMinutes || 20) * 60 * 1000,
    });
    metrics.recordAgentCall({
      role: "repair-candidate",
      cluster_id: cluster.cluster_id,
      candidate: k + 1,
      ok: result.ok,
      elapsedMs: result.elapsedMs,
    });
    commitAll(wt.path, `repair candidate ${cluster.cluster_id} #${k + 1}`);

    const build = ensureBuilt(wt.path);
    if (!build.ok) {
      removeWorktree(workspaceDir, wt.path);
      continue;
    }
    const scorePath = path.join(runDir, `score-repair-${safeKey}-cand${k + 1}.json`);
    const after = scoreVisible(wt.path, scorePath, holdoutFile).report;
    candidates.push({
      branch: wt.branch,
      path: wt.path,
      after,
      accepted: acceptsChangeset(beforeReport, after),
      passed: after.passed || 0,
    });
  }

  const winners = candidates
    .filter((c) => c.accepted)
    .sort((a, b) => b.passed - a.passed);

  let outcome = {
    accepted: false,
    after: beforeReport,
    gain: 0,
    elapsedMs: Date.now() - started,
    rung: 2,
  };

  if (winners.length) {
    const winner = winners[0];
    const merge = mergeBranchNoFf(workspaceDir, winner.branch);
    const files = listTrackedFiles(workspaceDir).filter((f) => {
      const n = f.replace(/\\/g, "/");
      return (n.startsWith("src/") && n.endsWith(".ts")) || n.endsWith(".md");
    });
    const markers = findConflictMarkers(workspaceDir, files);
    if (!merge.ok || markers.length) {
      abortMerge(workspaceDir);
      resetHard(workspaceDir, checkpointSha);
    } else {
      const build = ensureBuilt(workspaceDir);
      if (build.ok) {
        const afterPath = path.join(runDir, `score-repair-${safeKey}-rung2.json`);
        const after = scoreVisible(workspaceDir, afterPath, holdoutFile).report;
        if (acceptsChangeset(beforeReport, after)) {
          outcome = {
            accepted: true,
            after,
            gain: (after.passed || 0) - (beforeReport.passed || 0),
            elapsedMs: Date.now() - started,
            rung: 2,
          };
        } else {
          resetHard(workspaceDir, checkpointSha);
        }
      } else {
        resetHard(workspaceDir, checkpointSha);
      }
    }
  }

  for (const c of candidates) {
    removeWorktree(workspaceDir, c.path);
  }
  deleteBranchesByPrefix(workspaceDir, "repair/");

  return outcome;
}

/**
 * @param {{
 *   workspaceDir: string,
 *   config: object,
 *   runDir: string,
 *   coordMode: string,
 *   metrics: object,
 *   progress: object|null,
 *   ensureBuilt: (dir: string) => {ok:boolean, stderr?:string},
 * }} args
 */
export async function runRepairPhase({
  workspaceDir,
  config,
  runDir,
  coordMode,
  metrics,
  progress = null,
  ensureBuilt,
}) {
  const repairCfg = config.repair || {};
  const maxRounds = repairCfg.maxRounds ?? 0;
  if (config.mock || maxRounds <= 0) return;

  const holdoutFile = holdoutFilePath(runDir);
  const phaseStarted = Date.now();
  const maxPhaseMs = (repairCfg.maxPhaseMinutes ?? 90) * 60 * 1000;
  const target = repairCfg.target ?? 1.0;
  const minGainItems = repairCfg.minGainItems ?? 1;
  const startRound = (progress?.global_repair_rounds_done ?? 0) + 1;

  let ledger = loadLedger(runDir);

  for (let r = startRound; r <= maxRounds; r += 1) {
    if (Date.now() - phaseStarted > maxPhaseMs) {
      console.warn(`[repair] phase time budget exhausted after round ${r - 1}`);
      break;
    }

    const build = ensureBuilt(workspaceDir);
    if (!build.ok) {
      console.warn(`[repair] round ${r}: build failed; skipping phase`);
      return;
    }

    const beforePath = path.join(runDir, `score-repair-before-${r}.json`);
    const scored = scoreVisible(workspaceDir, beforePath, holdoutFile);
    metrics.recordScore({ phase: `repair-before-${r}`, ...scored.report });
    // Keep legacy phase labels for continuity in score_curve readers.
    metrics.recordScore({ phase: `global-before-${r}`, ...scored.report });

    const rateBefore = scored.report?.rate ?? 0;
    const passedBefore = scored.report?.passed ?? 0;
    console.log(`[repair] round ${r}: visible rate=${(rateBefore * 100).toFixed(1)}% (${passedBefore}/${scored.report.total})`);

    updateFromReport(ledger, scored.report, `repair-before-${r}`);
    saveLedger(runDir, ledger);

    if (rateBefore >= target) break;

    await runAdjudication({
      workspaceDir,
      config,
      runDir,
      metrics,
      ledger,
      report: scored.report,
    });
    ledger = loadLedger(runDir);

    const repairableIds = repairableFailingIds(ledger, scored.report);
    if (!repairableIds.length) {
      console.log(`[repair] round ${r}: no repairable failures (all routed out or none)`);
      break;
    }

    let clusters = await buildClusters({
      workspaceDir,
      config,
      runDir,
      metrics,
      report: scored.report,
      repairableIds,
    });
    clusters = clusters.sort((a, b) => b.item_ids.length - a.item_ids.length);

    let roundPassed = passedBefore;
    let currentReport = scored.report;

    for (const cluster of clusters) {
      if (Date.now() - phaseStarted > maxPhaseMs) {
        console.warn(`[repair] time budget hit mid-round ${r}`);
        break;
      }

      console.log(`[repair] cluster ${cluster.cluster_id}: ${cluster.item_ids.length} items — ${cluster.hypothesis}`);

      // Checkpoint before any rung so rung2 merge can be rolled back.
      commitAll(workspaceDir, `checkpoint: pre-cluster ${cluster.cluster_id}`);
      const clusterCheckpoint = headSha(workspaceDir);

      let outcome = await tryRung1({
        workspaceDir,
        config,
        runDir,
        coordMode,
        metrics,
        cluster,
        beforeReport: currentReport,
        holdoutFile,
        ensureBuilt,
      });

      if (!outcome.accepted) {
        resetHard(workspaceDir, clusterCheckpoint);
        outcome = await tryRung2({
          workspaceDir,
          config,
          runDir,
          coordMode,
          metrics,
          cluster,
          beforeReport: currentReport,
          holdoutFile,
          ensureBuilt,
        });
        if (!outcome.accepted) {
          resetHard(workspaceDir, clusterCheckpoint);
        }
      }

      metrics.data.repair_clusters.push({
        round: r,
        cluster_id: cluster.cluster_id,
        hypothesis: cluster.hypothesis,
        item_ids: cluster.item_ids,
        rung: outcome.rung,
        accepted: outcome.accepted,
        gain_items: outcome.gain,
        elapsedMs: outcome.elapsedMs,
        at: new Date().toISOString(),
      });

      // Also record in legacy-shaped global_repairs for compare continuity.
      metrics.recordGlobalRepair({
        round: r,
        sections: cluster.item_ids,
        rate_before: currentReport.rate,
        rate_after: outcome.after?.rate ?? currentReport.rate,
        reverted: !outcome.accepted,
        cluster_id: cluster.cluster_id,
        rung: outcome.rung,
      });

      if (outcome.accepted) {
        currentReport = outcome.after;
        roundPassed = outcome.after.passed || roundPassed;
        updateFromReport(ledger, currentReport, `repair-${cluster.cluster_id}`, {
          targetedIds: cluster.item_ids,
        });
        saveLedger(runDir, ledger);
      } else {
        updateFromReport(ledger, currentReport, `repair-${cluster.cluster_id}:stuck`, {
          targetedIds: cluster.item_ids,
        });
        saveLedger(runDir, ledger);
      }
    }

    const afterPath = path.join(runDir, `score-repair-after-${r}.json`);
    const afterScored = scoreVisible(workspaceDir, afterPath, holdoutFile);
    metrics.recordScore({ phase: `repair-after-${r}`, ...afterScored.report });
    metrics.recordScore({ phase: `global-after-${r}`, ...afterScored.report });

    if (progress) markRepairRound(runDir, progress, r);

    const gain = (afterScored.report.passed || 0) - passedBefore;
    console.log(`[repair] round ${r} done: +${gain} items → ${(afterScored.report.rate * 100).toFixed(1)}%`);
    if (gain < minGainItems) {
      console.log(`[repair] plateau (gain ${gain} < ${minGainItems}); stopping`);
      break;
    }
  }

  const routed = routedOutSummary(loadLedger(runDir));
  metrics.data.suspected_oracle_bugs = routed.suspected;
  metrics.data.spec_ambiguities = routed.ambiguities;
  metrics.data.unowned_requirements = routed.unowned;
  if (routed.suspected.length || routed.ambiguities.length) {
    console.warn(`[repair] human review needed: oracle=${routed.suspected.length} ambiguity=${routed.ambiguities.length}`);
  }
}
