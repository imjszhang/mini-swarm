/**
 * Shared final scoring + metrics finish for swarm runs.
 * Used by swarm.mjs (normal end) and finalize-swarm-run.mjs (salvage).
 */
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { abortMerge, commitCount, computeChurn } from "./git.mjs";
import { holdoutFilePath } from "./holdout.mjs";
import { saveTree, treeStats } from "./tree.mjs";
import {
  loadExamples,
  scanForOracleLiterals,
  scoreScope,
} from "./verifier.mjs";
import { countLoc } from "../metrics.mjs";

function abortLeftoverMerge(workspaceDir) {
  const mergeHead = path.join(workspaceDir, ".git", "MERGE_HEAD");
  if (!existsSync(mergeHead)) return false;
  console.warn("[finalize] aborting leftover MERGE_HEAD before scoring");
  abortMerge(workspaceDir);
  // Salvage path: if merge --abort cannot run (corrupt marker), drop the marker.
  if (existsSync(mergeHead)) {
    try { rmSync(mergeHead, { force: true }); } catch { /* ignore */ }
  }
  return true;
}

/**
 * @param {{
 *   workspaceDir: string,
 *   runDir: string,
 *   metrics: ReturnType<import("../metrics.mjs").createMetricsCollector>,
 *   tree: object,
 *   config: object,
 *   salvaged?: boolean,
 * }} opts
 */
export function finalizeRun({
  workspaceDir,
  runDir,
  metrics,
  tree,
  config,
  salvaged = false,
}) {
  abortLeftoverMerge(workspaceDir);

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

  const waivedSections = Array.isArray(tree.waived_sections)
    ? [...tree.waived_sections]
    : [];

  metrics.data.tree_stats = treeStats(tree);
  metrics.data.reviews = metrics.data.reviews || [];
  metrics.data.splits = metrics.data.splits || [];
  metrics.data.oversized_blocks = metrics.data.oversized_blocks || [];
  metrics.data.swarm_planner_rounds = tree.planner_rounds;
  metrics.data.waived_sections = waivedSections;
  metrics.data.waived_section_count = waivedSections.length;
  if (salvaged) metrics.data.salvaged = true;
  saveTree(runDir, tree);

  const metricsPath = metrics.finish({
    final_score: full.report,
    visible_score: visible.report,
    holdout_score: holdout.report,
    holdout_gap_pp: gapPp,
    overfit_alarm: gapPp != null && gapPp >= (config.holdout?.alarmPp ?? 5),
    oracle_literal_hits: oracleHits,
    commits: commitCount(workspaceDir),
    loc: countLoc(workspaceDir),
    churn: computeChurn(workspaceDir),
    tree_stats: treeStats(tree),
    swarm_planner_rounds: tree.planner_rounds,
    waived_sections: waivedSections,
    waived_section_count: waivedSections.length,
    salvaged: !!salvaged,
  });

  return {
    metricsPath,
    full: full.report,
    visible: visible.report,
    holdout: holdout.report,
    gapPp,
    oracleHits,
  };
}

