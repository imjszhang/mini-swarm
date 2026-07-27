/**
 * v12 repair engine: Stage A (visible) + Stage B (blind generalization),
 * ledger + adjudication + adaptive clustering + monotonic changeset acceptance +
 * best-of-N + rung3 strong model + decompose + overfit review + lessons.
 *
 * Mechanism code: no task-specific vocabulary beyond opaque "group" labels
 * coming from the verifier facade.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  abortMerge,
  commitAll,
  createWorktree,
  deleteBranchesByPrefix,
  findConflictMarkers,
  getDiff,
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
import { markGeneralizationRound, markRepairRound } from "./lib/progress.mjs";
import {
  buildAdjudicatePrompt,
  buildClusterPrompt,
  buildDecomposePrompt,
  buildOverfitReviewPrompt,
  buildRepairBlindPrompt,
  buildRepairClusterPrompt,
} from "./lib/prompts.mjs";
import { projectRoot } from "./lib/config.mjs";
import { getReferenceText, loadExamples, scanForOracleLiterals, scoreScope } from "./lib/verifier.mjs";
import { holdoutFilePath } from "./lib/holdout.mjs";
import { agentUsage, spawnAgent } from "./runner.mjs";

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

function buildGroupVerifyCmd(group, holdoutFile, examplesFile = null) {
  const scorer = path.join(projectRoot(), "scorer", "score.mjs");
  const parts = [
    `node ${JSON.stringify(scorer)}`,
    "--workspace .",
    `--sections ${JSON.stringify(group)}`,
  ];
  if (examplesFile) parts.push(`--examples ${JSON.stringify(examplesFile)}`);
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

function acceptsChangeset(before, after) {
  if ((after.passed || 0) < (before.passed || 0)) return false;
  const beforeFail = failingIdSet(before);
  const afterFail = failingIdSet(after);
  for (const id of afterFail) {
    if (!beforeFail.has(id)) return false;
  }
  return true;
}

async function parseAgentJson(result, retryFn) {
  // spawnAgent resolves { output, stderr } — never .stdout
  let parsed = extractJsonObject(result.output || result.stdout || "");
  if (parsed) return parsed;
  if (retryFn) {
    const retry = await retryFn();
    parsed = extractJsonObject(retry.output || retry.stdout || "");
    if (parsed) return parsed;
  }
  return null;
}

function lessonsPath(runDir) {
  return path.join(runDir, "lessons.md");
}

function appendLesson(runDir, line) {
  const p = lessonsPath(runDir);
  if (!existsSync(p)) {
    writeFileSync(p, "# Repair lessons (harness-generated)\n\n", "utf8");
  }
  appendFileSync(p, `${line}\n`, "utf8");
}

function recentLessons(runDir, n = 15) {
  const p = lessonsPath(runDir);
  if (!existsSync(p)) return "_None yet._";
  const lines = readFileSync(p, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  return lines.slice(-n).join("\n") || "_None yet._";
}

function resolveGenExamplesPath(config) {
  const rel = config.repair?.genExamples?.path || "spec/gen-examples-v12.json";
  return path.isAbsolute(rel) ? rel : path.join(projectRoot(), rel);
}

function scoreVisible(workspaceDir, jsonOut, holdoutFile) {
  return scoreScope(workspaceDir, jsonOut, {
    holdoutFile,
    holdoutMode: holdoutFile ? "exclude" : "include",
    truncate: 2000,
    maxFailures: 600,
  });
}

function scoreFull(workspaceDir, jsonOut) {
  return scoreScope(workspaceDir, jsonOut, {
    holdoutMode: "include",
    truncate: 2000,
    maxFailures: 600,
  });
}

async function runOverfitReview({
  workspaceDir,
  config,
  runDir,
  metrics,
  checkpointSha,
  clusterId,
}) {
  const diff = getDiff(workspaceDir, checkpointSha) || "";
  const prompt = buildOverfitReviewPrompt({ diff });
  const result = await spawnAgent({
    role: "overfit-reviewer",
    prompt,
    cwd: workspaceDir,
    config,
    runDir,
    logKey: `overfit-${String(clusterId).replace(/[^\w.-]+/g, "_")}`,
    timeoutMs: Math.min((config.taskTimeoutMinutes || 20) * 60 * 1000, 10 * 60 * 1000),
  });
  metrics.recordAgentCall({
    role: "overfit-reviewer",
    cluster_id: clusterId,
    ok: result.ok,
    ...agentUsage(result),
  });

  let parsed = extractJsonObject(result.output || "");
  if (!parsed) {
    const entry = {
      cluster_id: clusterId,
      verdict: "general",
      reasons: ["parse_fallback"],
      at: new Date().toISOString(),
    };
    metrics.data.overfit_reviews.push(entry);
    return entry;
  }
  const verdict = parsed.verdict === "suspicious" ? "suspicious" : "general";
  const entry = {
    cluster_id: clusterId,
    verdict,
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String) : [],
    at: new Date().toISOString(),
  };
  metrics.data.overfit_reviews.push(entry);
  if (verdict === "suspicious") {
    console.warn(`[repair] overfit review suspicious for ${clusterId}: ${entry.reasons.join("; ")}`);
  }
  return entry;
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
    role: "adjudicator",
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
    ...agentUsage(result),
  });

  let parsed = await parseAgentJson(result, async () => {
    const retry = await spawnOnce();
    metrics.recordAgentCall({
      role: "adjudicator",
      ok: retry.ok,
      ...agentUsage(retry),
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

  const prompt = buildClusterPrompt({ failures: failing, maxClusters });
  const spawnOnce = () => spawnAgent({
    role: "cluster",
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
    ...agentUsage(result),
  });

  let parsed = await parseAgentJson(result, async () => {
    const retry = await spawnOnce();
    metrics.recordAgentCall({
      role: "cluster",
      ok: retry.ok,
      ...agentUsage(retry),
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

async function maybeDecomposeCluster({
  workspaceDir,
  config,
  runDir,
  metrics,
  cluster,
  beforeReport,
}) {
  const threshold = config.repair?.decomposeThreshold ?? 12;
  if (cluster.item_ids.length <= threshold) return [cluster];

  const failures = (beforeReport.failures || []).filter((f) => cluster.item_ids.includes(f.id));
  const groups = [...new Set(failures.map((f) => f.group).filter(Boolean))];
  const reference = groups.map((g) => getReferenceText(g)).filter(Boolean).join("\n\n---\n\n");
  const prompt = buildDecomposePrompt({
    clusterId: cluster.cluster_id,
    hypothesis: cluster.hypothesis,
    itemCount: cluster.item_ids.length,
    failures,
    reference,
  });

  const spawnOnce = () => spawnAgent({
    role: "decomposer",
    prompt,
    cwd: workspaceDir,
    config,
    runDir,
    logKey: `decompose-${String(cluster.cluster_id).replace(/[^\w.-]+/g, "_")}`,
    timeoutMs: (config.taskTimeoutMinutes || 20) * 60 * 1000,
  });

  const result = await spawnOnce();
  metrics.recordAgentCall({
    role: "decomposer",
    cluster_id: cluster.cluster_id,
    ok: result.ok,
    ...agentUsage(result),
  });

  const parsed = await parseAgentJson(result, async () => {
    const retry = await spawnOnce();
    metrics.recordAgentCall({
      role: "decomposer",
      cluster_id: cluster.cluster_id,
      ok: retry.ok,
      ...agentUsage(retry),
      retry: true,
    });
    return retry;
  });

  if (!parsed?.subclusters || !Array.isArray(parsed.subclusters)) {
    metrics.data.decompositions.push({
      cluster_id: cluster.cluster_id,
      ok: false,
      reason: "parse_fallback",
      at: new Date().toISOString(),
    });
    return [cluster];
  }

  const idSet = new Set(cluster.item_ids);
  const used = new Set();
  const designNote = String(parsed.design_note || "");
  const designPath = path.join(runDir, `repair-design-${String(cluster.cluster_id).replace(/[^\w.-]+/g, "_")}.md`);
  if (designNote) writeFileSync(designPath, `${designNote}\n`, "utf8");

  const sub = [];
  for (const c of parsed.subclusters) {
    const ids = (c.item_ids || []).filter((id) => idSet.has(id) && !used.has(id));
    for (const id of ids) used.add(id);
    if (ids.length) {
      sub.push({
        cluster_id: `${cluster.cluster_id}/${c.cluster_id || `s${sub.length + 1}`}`,
        hypothesis: String(c.hypothesis || cluster.hypothesis),
        item_ids: ids,
        design_note: designNote,
      });
    }
  }
  const leftover = cluster.item_ids.filter((id) => !used.has(id));
  if (leftover.length) {
    sub.push({
      cluster_id: `${cluster.cluster_id}/leftover`,
      hypothesis: cluster.hypothesis,
      item_ids: leftover,
      design_note: designNote,
    });
  }

  metrics.data.decompositions.push({
    cluster_id: cluster.cluster_id,
    ok: true,
    subclusters: sub.length,
    design_path: designNote ? designPath : null,
    at: new Date().toISOString(),
  });

  return sub.length ? sub : [cluster];
}

async function finalizeAccept({
  workspaceDir,
  config,
  runDir,
  metrics,
  checkpointSha,
  clusterId,
  after,
  beforeReport,
  gain,
  elapsedMs,
  rung,
  stage,
}) {
  const review = await runOverfitReview({
    workspaceDir,
    config,
    runDir,
    metrics,
    checkpointSha,
    clusterId,
  });
  if (review.verdict === "suspicious" && config.repair?.rejectSuspicious) {
    resetHard(workspaceDir, checkpointSha);
    appendLesson(runDir, `${stage} | ${clusterId} | r${rung} | rejected | 0 | overfit-suspicious`);
    return {
      accepted: false,
      after: beforeReport,
      gain: 0,
      elapsedMs,
      rung,
      reason: "overfit-suspicious",
    };
  }
  appendLesson(runDir, `${stage} | ${clusterId} | r${rung} | accepted | ${gain} | ok`);
  return {
    accepted: true,
    after,
    gain,
    elapsedMs,
    rung,
    reason: "ok",
  };
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
  scoreFn,
  promptBuilder,
  stage,
}) {
  const started = Date.now();
  commitAll(workspaceDir, `checkpoint: pre-repair ${cluster.cluster_id}`);
  const checkpointSha = headSha(workspaceDir);

  const prompt = promptBuilder({ strategySuffix: "" });
  const safeKey = String(cluster.cluster_id).replace(/[^\w.-]+/g, "_");
  const result = await spawnAgent({
    role: "repair",
    prompt,
    cwd: workspaceDir,
    config,
    runDir,
    logKey: `repair-${stage}-${safeKey}`,
    timeoutMs: (config.taskTimeoutMinutes || 20) * 60 * 1000,
  });
  metrics.recordAgentCall({
    role: "repair",
    cluster_id: cluster.cluster_id,
    ok: result.ok,
    ...agentUsage(result),
  });
  commitAll(workspaceDir, `repair ${cluster.cluster_id}`);

  const build = ensureBuilt(workspaceDir);
  if (!build.ok) {
    resetHard(workspaceDir, checkpointSha);
    appendLesson(runDir, `${stage} | ${cluster.cluster_id} | r1 | rejected | 0 | build-fail`);
    return { accepted: false, after: beforeReport, gain: 0, elapsedMs: Date.now() - started, rung: 1, reason: "build-fail" };
  }

  const afterPath = path.join(runDir, `score-repair-${stage}-${safeKey}-rung1.json`);
  const after = scoreFn(workspaceDir, afterPath).report;
  const gain = (after.passed || 0) - (beforeReport.passed || 0);
  // Stage B requires strict full-suite gain; Stage A allows non-decreasing visible.
  const ok = acceptsChangeset(beforeReport, after) && (stage !== "B" || gain > 0);
  if (!ok) {
    resetHard(workspaceDir, checkpointSha);
    const reason = !acceptsChangeset(beforeReport, after) ? "regression" : "no-gain";
    appendLesson(runDir, `${stage} | ${cluster.cluster_id} | r1 | rejected | 0 | ${reason}`);
    return { accepted: false, after: beforeReport, gain: 0, elapsedMs: Date.now() - started, rung: 1, reason };
  }
  return finalizeAccept({
    workspaceDir, config, runDir, metrics, checkpointSha,
    clusterId: cluster.cluster_id, after, beforeReport, gain,
    elapsedMs: Date.now() - started, rung: 1, stage,
  });
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
  scoreFn,
  promptBuilder,
  stage,
}) {
  const started = Date.now();
  const n = config.repair?.candidates ?? 2;
  const worktreesRoot = path.join(runDir, "worktrees-repair");
  mkdirSync(worktreesRoot, { recursive: true });
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

    const prompt = promptBuilder({ strategySuffix: strategies[k] || strategies[0] });
    const result = await spawnAgent({
      role: "repair-candidate",
      prompt,
      cwd: wt.path,
      config,
      runDir,
      logKey: `repair-cand-${stage}-${safeKey}-${k + 1}`,
      timeoutMs: (config.taskTimeoutMinutes || 20) * 60 * 1000,
    });
    metrics.recordAgentCall({
      role: "repair-candidate",
      cluster_id: cluster.cluster_id,
      candidate: k + 1,
      ok: result.ok,
      ...agentUsage(result),
    });
    commitAll(wt.path, `repair candidate ${cluster.cluster_id} #${k + 1}`);

    const build = ensureBuilt(wt.path);
    if (!build.ok) {
      removeWorktree(workspaceDir, wt.path);
      continue;
    }
    const scorePath = path.join(runDir, `score-repair-${stage}-${safeKey}-cand${k + 1}.json`);
    const after = scoreFn(wt.path, scorePath).report;
    const gain = (after.passed || 0) - (beforeReport.passed || 0);
    candidates.push({
      branch: wt.branch,
      path: wt.path,
      after,
      accepted: acceptsChangeset(beforeReport, after) && (stage !== "B" || gain > 0),
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
    reason: "no-winner",
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
      appendLesson(runDir, `${stage} | ${cluster.cluster_id} | r2 | rejected | 0 | merge-fail`);
    } else {
      const build = ensureBuilt(workspaceDir);
      if (build.ok) {
        const afterPath = path.join(runDir, `score-repair-${stage}-${safeKey}-rung2.json`);
        const after = scoreFn(workspaceDir, afterPath).report;
        const gain = (after.passed || 0) - (beforeReport.passed || 0);
        const ok = acceptsChangeset(beforeReport, after) && (stage !== "B" || gain > 0);
        if (ok) {
          outcome = await finalizeAccept({
            workspaceDir, config, runDir, metrics, checkpointSha,
            clusterId: cluster.cluster_id, after, beforeReport, gain,
            elapsedMs: Date.now() - started, rung: 2, stage,
          });
        } else {
          resetHard(workspaceDir, checkpointSha);
          appendLesson(runDir, `${stage} | ${cluster.cluster_id} | r2 | rejected | 0 | regression`);
        }
      } else {
        resetHard(workspaceDir, checkpointSha);
        appendLesson(runDir, `${stage} | ${cluster.cluster_id} | r2 | rejected | 0 | build-fail`);
      }
    }
  } else {
    appendLesson(runDir, `${stage} | ${cluster.cluster_id} | r2 | rejected | 0 | no-winner`);
  }

  for (const c of candidates) {
    removeWorktree(workspaceDir, c.path);
  }
  deleteBranchesByPrefix(workspaceDir, "repair/");

  return outcome;
}

async function tryRung3({
  workspaceDir,
  config,
  runDir,
  coordMode,
  metrics,
  cluster,
  beforeReport,
  ensureBuilt,
  scoreFn,
  promptBuilder,
  stage,
}) {
  if (config.repair?.rung3Enabled === false) {
    return { accepted: false, after: beforeReport, gain: 0, elapsedMs: 0, rung: 3, reason: "disabled" };
  }
  const started = Date.now();
  commitAll(workspaceDir, `checkpoint: pre-rung3 ${cluster.cluster_id}`);
  const checkpointSha = headSha(workspaceDir);

  const prompt = promptBuilder({
    strategySuffix:
      "Strategy (strong model, design authority): you may refactor implicated modules to match the normative reference. Prefer structural correctness over local patches. Still do not hard-code suite strings.",
  });
  const safeKey = String(cluster.cluster_id).replace(/[^\w.-]+/g, "_");
  const result = await spawnAgent({
    role: "repair-strong",
    prompt,
    cwd: workspaceDir,
    config,
    runDir,
    logKey: `repair-strong-${stage}-${safeKey}`,
    timeoutMs: (config.taskTimeoutMinutes || 20) * 60 * 1000,
  });
  metrics.recordAgentCall({
    role: "repair-strong",
    cluster_id: cluster.cluster_id,
    ok: result.ok,
    ...agentUsage(result),
  });
  commitAll(workspaceDir, `repair-strong ${cluster.cluster_id}`);

  const build = ensureBuilt(workspaceDir);
  if (!build.ok) {
    resetHard(workspaceDir, checkpointSha);
    appendLesson(runDir, `${stage} | ${cluster.cluster_id} | r3 | rejected | 0 | build-fail`);
    return { accepted: false, after: beforeReport, gain: 0, elapsedMs: Date.now() - started, rung: 3, reason: "build-fail" };
  }

  const afterPath = path.join(runDir, `score-repair-${stage}-${safeKey}-rung3.json`);
  const after = scoreFn(workspaceDir, afterPath).report;
  const gain = (after.passed || 0) - (beforeReport.passed || 0);
  const ok = acceptsChangeset(beforeReport, after) && (stage !== "B" || gain > 0);
  if (!ok) {
    resetHard(workspaceDir, checkpointSha);
    appendLesson(runDir, `${stage} | ${cluster.cluster_id} | r3 | rejected | 0 | regression`);
    return { accepted: false, after: beforeReport, gain: 0, elapsedMs: Date.now() - started, rung: 3, reason: "regression" };
  }
  return finalizeAccept({
    workspaceDir, config, runDir, metrics, checkpointSha,
    clusterId: cluster.cluster_id, after, beforeReport, gain,
    elapsedMs: Date.now() - started, rung: 3, stage,
  });
}

async function runClusterLadder({
  workspaceDir,
  config,
  runDir,
  coordMode,
  metrics,
  cluster,
  beforeReport,
  holdoutFile,
  ensureBuilt,
  scoreFn,
  promptBuilder,
  stage,
}) {
  let outcome = await tryRung1({
    workspaceDir, config, runDir, coordMode, metrics, cluster,
    beforeReport, holdoutFile, ensureBuilt, scoreFn, promptBuilder, stage,
  });
  if (!outcome.accepted) {
    outcome = await tryRung2({
      workspaceDir, config, runDir, coordMode, metrics, cluster,
      beforeReport, holdoutFile, ensureBuilt, scoreFn, promptBuilder, stage,
    });
  }
  if (!outcome.accepted) {
    outcome = await tryRung3({
      workspaceDir, config, runDir, coordMode, metrics, cluster,
      beforeReport, ensureBuilt, scoreFn, promptBuilder, stage,
    });
  }
  return outcome;
}

async function runStageA({
  workspaceDir,
  config,
  runDir,
  coordMode,
  metrics,
  progress,
  ensureBuilt,
  holdoutFile,
  phaseStarted,
  maxPhaseMs,
}) {
  const repairCfg = config.repair || {};
  const maxRounds = repairCfg.maxRounds ?? 0;
  if (maxRounds <= 0) return { stopped: "disabled" };

  const target = repairCfg.target ?? 1.0;
  const minGainItems = repairCfg.minGainItems ?? 1;
  const plateauRounds = repairCfg.plateauRounds ?? 2;
  const startRound = (progress?.global_repair_rounds_done ?? 0) + 1;
  let ledger = loadLedger(runDir);
  let consecutiveNoGain = 0;

  for (let r = startRound; r <= maxRounds; r += 1) {
    if (Date.now() - phaseStarted > maxPhaseMs) {
      console.warn(`[repair] phase time budget exhausted after stage-A round ${r - 1}`);
      return { stopped: "budget" };
    }

    const build = ensureBuilt(workspaceDir);
    if (!build.ok) {
      console.warn(`[repair] stage-A round ${r}: build failed; skipping`);
      return { stopped: "build" };
    }

    const beforePath = path.join(runDir, `score-repair-before-${r}.json`);
    const scored = scoreVisible(workspaceDir, beforePath, holdoutFile);
    metrics.recordScore({ phase: `repair-before-${r}`, ...scored.report });
    metrics.recordScore({ phase: `global-before-${r}`, ...scored.report });

    const rateBefore = scored.report?.rate ?? 0;
    const passedBefore = scored.report?.passed ?? 0;
    console.log(`[repair] stage-A round ${r}: visible rate=${(rateBefore * 100).toFixed(1)}% (${passedBefore}/${scored.report.total})`);

    updateFromReport(ledger, scored.report, `repair-before-${r}`);
    saveLedger(runDir, ledger);

    if (rateBefore >= target) {
      console.log(`[repair] stage-A target reached`);
      if (progress) markRepairRound(runDir, progress, r);
      return { stopped: "target" };
    }

    await runAdjudication({
      workspaceDir, config, runDir, metrics, ledger, report: scored.report,
    });
    ledger = loadLedger(runDir);

    const repairableIds = repairableFailingIds(ledger, scored.report);
    if (!repairableIds.length) {
      console.log(`[repair] stage-A round ${r}: no repairable failures`);
      if (progress) markRepairRound(runDir, progress, r);
      return { stopped: "routed-out" };
    }

    let clusters = await buildClusters({
      workspaceDir, config, runDir, metrics, report: scored.report, repairableIds,
    });
    clusters = clusters.sort((a, b) => b.item_ids.length - a.item_ids.length);

    let currentReport = scored.report;

    for (const rawCluster of clusters) {
      if (Date.now() - phaseStarted > maxPhaseMs) {
        console.warn(`[repair] time budget hit mid stage-A round ${r}`);
        break;
      }

      const subclusters = await maybeDecomposeCluster({
        workspaceDir, config, runDir, metrics, cluster: rawCluster, beforeReport: currentReport,
      });

      for (const cluster of subclusters) {
        if (Date.now() - phaseStarted > maxPhaseMs) break;
        console.log(`[repair] stage-A cluster ${cluster.cluster_id}: ${cluster.item_ids.length} items — ${cluster.hypothesis}`);

        commitAll(workspaceDir, `checkpoint: pre-cluster ${cluster.cluster_id}`);
        const clusterCheckpoint = headSha(workspaceDir);

        const failures = (currentReport.failures || []).filter((f) => cluster.item_ids.includes(f.id));
        const groups = [...new Set(failures.map((f) => f.group).filter(Boolean))];
        const reference = groups.map((g) => getReferenceText(g)).filter(Boolean).join("\n\n---\n\n");
        const verifyCmd = buildVerifyCmd(cluster.item_ids, holdoutFile);
        const lessons = recentLessons(runDir);

        const promptBuilder = ({ strategySuffix }) => buildRepairClusterPrompt({
          rate: currentReport.rate,
          clusterId: cluster.cluster_id,
          hypothesis: cluster.hypothesis,
          failures,
          reference,
          verifyCmd,
          coordMode,
          lessons,
          designNote: cluster.design_note || "",
          strategySuffix,
        });

        let outcome = await runClusterLadder({
          workspaceDir, config, runDir, coordMode, metrics, cluster,
          beforeReport: currentReport, holdoutFile, ensureBuilt,
          scoreFn: (dir, out) => scoreVisible(dir, out, holdoutFile),
          promptBuilder,
          stage: "A",
        });

        if (!outcome.accepted) {
          resetHard(workspaceDir, clusterCheckpoint);
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
          reason: outcome.reason,
          stage: "A",
          at: new Date().toISOString(),
        });
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
          updateFromReport(ledger, currentReport, `repair-${cluster.cluster_id}`, {
            targetedIds: cluster.item_ids,
          });
        } else {
          updateFromReport(ledger, currentReport, `repair-${cluster.cluster_id}:stuck`, {
            targetedIds: cluster.item_ids,
          });
        }
        saveLedger(runDir, ledger);
      }
    }

    const afterPath = path.join(runDir, `score-repair-after-${r}.json`);
    const afterScored = scoreVisible(workspaceDir, afterPath, holdoutFile);
    metrics.recordScore({ phase: `repair-after-${r}`, ...afterScored.report });
    metrics.recordScore({ phase: `global-after-${r}`, ...afterScored.report });

    const hits = scanForOracleLiterals(workspaceDir, loadExamples());
    if (hits.length) {
      console.warn(`[repair] stage-A round ${r}: oracle literal hits=${hits.length}`);
      metrics.data.oracle_literal_hits = hits;
    }

    if (progress) markRepairRound(runDir, progress, r);

    const gain = (afterScored.report.passed || 0) - passedBefore;
    console.log(`[repair] stage-A round ${r} done: +${gain} items → ${(afterScored.report.rate * 100).toFixed(1)}%`);
    if (gain < minGainItems) {
      consecutiveNoGain += 1;
      if (consecutiveNoGain >= plateauRounds) {
        console.log(`[repair] stage-A plateau (${consecutiveNoGain} rounds < ${minGainItems}); stopping stage-A`);
        return { stopped: "plateau" };
      }
    } else {
      consecutiveNoGain = 0;
    }
  }
  return { stopped: "max-rounds" };
}

async function runStageB({
  workspaceDir,
  config,
  runDir,
  coordMode,
  metrics,
  progress,
  ensureBuilt,
  holdoutFile,
  phaseStarted,
  maxPhaseMs,
}) {
  const genCfg = config.repair?.generalization || {};
  const maxRounds = genCfg.maxRounds ?? 3;
  if (maxRounds <= 0) return { stopped: "disabled" };

  const plateauRounds = genCfg.plateauRounds ?? 2;
  const minGainItems = config.repair?.minGainItems ?? 1;
  const genPath = resolveGenExamplesPath(config);
  const genExists = existsSync(genPath);
  metrics.data.gen_examples = {
    path: genPath,
    exists: genExists,
  };
  if (!genExists) {
    console.warn(`[repair] stage-B: missing gen examples at ${genPath}; VERIFY_GEN_CMD will still be emitted`);
  }

  const startRound = (progress?.generalization_rounds_done ?? 0) + 1;
  let consecutiveNoGain = 0;
  let ledger = loadLedger(runDir);

  for (let r = startRound; r <= maxRounds; r += 1) {
    if (Date.now() - phaseStarted > maxPhaseMs) {
      console.warn(`[repair] phase time budget exhausted during stage-B round ${r}`);
      return { stopped: "budget" };
    }

    const build = ensureBuilt(workspaceDir);
    if (!build.ok) {
      console.warn(`[repair] stage-B round ${r}: build failed`);
      return { stopped: "build" };
    }

    const beforePath = path.join(runDir, `score-stageb-before-${r}.json`);
    const scored = scoreFull(workspaceDir, beforePath);
    metrics.recordScore({ phase: `stageb-before-${r}`, ...scored.report });

    const passedBefore = scored.report.passed || 0;
    const rateBefore = scored.report.rate || 0;
    console.log(`[repair] stage-B round ${r}: full rate=${(rateBefore * 100).toFixed(1)}% (${passedBefore}/${scored.report.total})`);

    updateFromReport(ledger, scored.report, `stageb-before-${r}`);
    saveLedger(runDir, ledger);

    if (rateBefore >= (config.repair?.target ?? 1.0)) {
      console.log(`[repair] stage-B target reached (full suite)`);
      if (progress) markGeneralizationRound(runDir, progress, r);
      return { stopped: "target" };
    }

    const failing = scored.report.failures || [];
    if (!failing.length) {
      if (progress) markGeneralizationRound(runDir, progress, r);
      return { stopped: "target" };
    }

    // One cluster per failing group (opaque counts only in agent dossier).
    const byGroup = new Map();
    for (const f of failing) {
      const g = f.group || "default";
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(f);
    }
    const groups = [...byGroup.entries()]
      .sort((a, b) => b[1].length - a[1].length);

    let currentReport = scored.report;

    for (const [group, groupFails] of groups) {
      if (Date.now() - phaseStarted > maxPhaseMs) break;

      const cluster = {
        cluster_id: `blind-${group.replace(/[^\w.-]+/g, "_")}`,
        hypothesis: `Blind fix for group ${group}`,
        item_ids: groupFails.map((f) => f.id),
        group,
      };
      console.log(`[repair] stage-B cluster ${cluster.cluster_id}: ${cluster.item_ids.length} failures (blind)`);

      commitAll(workspaceDir, `checkpoint: pre-stageb ${cluster.cluster_id}`);
      const clusterCheckpoint = headSha(workspaceDir);

      const reference = getReferenceText(group);
      const lessons = recentLessons(runDir);
      const verifyGenCmd = buildGroupVerifyCmd(group, null, genExists ? genPath : null);
      const verifyVisibleCmd = buildGroupVerifyCmd(group, holdoutFile, null);

      const promptBuilder = ({ strategySuffix }) => buildRepairBlindPrompt({
        rate: currentReport.rate,
        group,
        failCount: groupFails.length,
        reference,
        verifyGenCmd,
        verifyVisibleCmd,
        coordMode,
        lessons,
        strategySuffix,
      });

      let outcome = await runClusterLadder({
        workspaceDir, config, runDir, coordMode, metrics, cluster,
        beforeReport: currentReport, holdoutFile, ensureBuilt,
        scoreFn: (dir, out) => scoreFull(dir, out),
        promptBuilder,
        stage: "B",
      });

      if (!outcome.accepted) {
        resetHard(workspaceDir, clusterCheckpoint);
      }

      metrics.data.repair_stage_b.push({
        round: r,
        group,
        cluster_id: cluster.cluster_id,
        rung: outcome.rung,
        accepted: outcome.accepted,
        gain_full: outcome.gain,
        elapsedMs: outcome.elapsedMs,
        reason: outcome.reason,
        at: new Date().toISOString(),
      });

      if (outcome.accepted) {
        currentReport = outcome.after;
        updateFromReport(ledger, currentReport, `stageb-${cluster.cluster_id}`, {
          targetedIds: cluster.item_ids,
        });
        saveLedger(runDir, ledger);
      }
    }

    const afterPath = path.join(runDir, `score-stageb-after-${r}.json`);
    const afterScored = scoreFull(workspaceDir, afterPath);
    metrics.recordScore({ phase: `stageb-after-${r}`, ...afterScored.report });

    const hits = scanForOracleLiterals(workspaceDir, loadExamples());
    if (hits.length) {
      console.warn(`[repair] stage-B round ${r}: oracle literal hits=${hits.length}`);
      metrics.data.oracle_literal_hits = hits;
    }

    if (progress) markGeneralizationRound(runDir, progress, r);

    const gain = (afterScored.report.passed || 0) - passedBefore;
    console.log(`[repair] stage-B round ${r} done: +${gain} full items → ${(afterScored.report.rate * 100).toFixed(1)}%`);
    if (gain < minGainItems) {
      consecutiveNoGain += 1;
      if (consecutiveNoGain >= plateauRounds) {
        console.log(`[repair] stage-B plateau; stopping`);
        return { stopped: "plateau" };
      }
    } else {
      consecutiveNoGain = 0;
    }
  }
  return { stopped: "max-rounds" };
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
  if (config.mock) return;

  const holdoutFile = holdoutFilePath(runDir);
  const phaseStarted = Date.now();
  const maxPhaseMs = (repairCfg.maxPhaseMinutes ?? 240) * 60 * 1000;

  // Ensure arrays exist even if metrics collector is older.
  metrics.data.repair_clusters = metrics.data.repair_clusters || [];
  metrics.data.repair_stage_b = metrics.data.repair_stage_b || [];
  metrics.data.overfit_reviews = metrics.data.overfit_reviews || [];
  metrics.data.decompositions = metrics.data.decompositions || [];

  console.log("[repair] Stage A — visible repair");
  await runStageA({
    workspaceDir, config, runDir, coordMode, metrics, progress, ensureBuilt,
    holdoutFile, phaseStarted, maxPhaseMs,
  });

  if (Date.now() - phaseStarted > maxPhaseMs) {
    console.warn("[repair] skipping Stage B — phase budget exhausted");
  } else {
    console.log("[repair] Stage B — blind generalization (full-suite acceptance)");
    await runStageB({
      workspaceDir, config, runDir, coordMode, metrics, progress, ensureBuilt,
      holdoutFile, phaseStarted, maxPhaseMs,
    });
  }

  const routed = routedOutSummary(loadLedger(runDir));
  metrics.data.suspected_oracle_bugs = routed.suspected;
  metrics.data.spec_ambiguities = routed.ambiguities;
  metrics.data.unowned_requirements = routed.unowned;
  if (routed.suspected.length || routed.ambiguities.length) {
    console.warn(`[repair] human review needed: oracle=${routed.suspected.length} ambiguity=${routed.ambiguities.length}`);
  }
}
