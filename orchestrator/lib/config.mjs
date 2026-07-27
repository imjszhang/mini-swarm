import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const STRONG_ROLES = new Set([
  "adjudicator",
  "cluster",
  "decomposer",
  "repair-strong",
  "swarm-planner",
  "splitter",
  "review-spec",
]);
const REVIEWER_ROLES = new Set([
  "overfit-reviewer",
  "reviewer",
  "review-diff",
  "review-codebase",
]);

function normalizeRepair(raw) {
  const r = raw.repair && typeof raw.repair === "object" ? raw.repair : null;
  const base = r
    ? {
      maxRounds: r.maxRounds ?? 4,
      target: r.target ?? 1.0,
      exhaustiveThreshold: r.exhaustiveThreshold ?? 24,
      topGroups: r.topGroups ?? 3,
      maxClusters: r.maxClusters ?? 8,
      candidates: r.candidates ?? 2,
      minGainItems: r.minGainItems ?? 1,
      maxPhaseMinutes: r.maxPhaseMinutes ?? 240,
      stuckThreshold: r.stuckThreshold ?? 2,
      plateauRounds: r.plateauRounds ?? 2,
      rung3Enabled: r.rung3Enabled !== false,
      decomposeThreshold: r.decomposeThreshold ?? 12,
      rejectSuspicious: !!r.rejectSuspicious,
      genExamples: {
        seed: r.genExamples?.seed ?? "v12",
        count: r.genExamples?.count ?? 300,
        path: r.genExamples?.path ?? "spec/gen-examples-v12.json",
      },
      generalization: {
        maxRounds: r.generalization?.maxRounds ?? 3,
        plateauRounds: r.generalization?.plateauRounds ?? 2,
      },
    }
    : {
      // Compat: synthesize from legacy v10 keys.
      maxRounds: raw.maxGlobalRepairRounds ?? 2,
      target: raw.globalRepairTarget ?? 1.0,
      exhaustiveThreshold: 24,
      topGroups: raw.globalRepairTopSections ?? 3,
      maxClusters: 8,
      candidates: 2,
      minGainItems: 1,
      maxPhaseMinutes: 240,
      stuckThreshold: 2,
      plateauRounds: 2,
      rung3Enabled: true,
      decomposeThreshold: 12,
      rejectSuspicious: false,
      genExamples: { seed: "v12", count: 300, path: "spec/gen-examples-v12.json" },
      generalization: { maxRounds: 3, plateauRounds: 2 },
    };
  return base;
}

function normalizeHoldout(raw) {
  const h = raw.holdout && typeof raw.holdout === "object" ? raw.holdout : {};
  return {
    enabled: h.enabled !== false,
    ratio: h.ratio ?? 0.15,
    seed: h.seed ?? "v11",
    alarmPp: h.alarmPp ?? 5,
    failOnOracleLiterals: !!h.failOnOracleLiterals,
  };
}

function normalizeSwarm(raw) {
  const s = raw.swarm && typeof raw.swarm === "object" ? raw.swarm : {};
  return {
    budgetMinutes: s.budgetMinutes ?? 240,
    runToDone: !!s.runToDone,
    maxWallMinutes: s.maxWallMinutes ?? 480,
    concurrency: s.concurrency ?? 8,
    plannerReportBatch: s.plannerReportBatch ?? 3,
    reviewEveryNMerges: s.reviewEveryNMerges ?? 5,
    reviewPerspectives: s.reviewPerspectives ?? 3,
    oversizedFileLines: s.oversizedFileLines ?? 400,
    maxTreeDepth: s.maxTreeDepth ?? 2,
    guideMaxLines: s.guideMaxLines ?? raw.guideMaxLines ?? 80,
    observeScoreEveryMerges: s.observeScoreEveryMerges ?? 3,
    specTextMaxChars: s.specTextMaxChars ?? 64000,
    maxLeafAttempts: s.maxLeafAttempts ?? 3,
  };
}

/**
 * Resolve model slug for a role. Strong roles → models.strong → worker;
 * reviewer-like → models.reviewer → worker; else models[role] → worker.
 */
export function resolveModel(config, role) {
  const models = config?.models || {};
  const worker = models.worker || "composer-2.5-fast";
  if (models[role]) return models[role];
  if (STRONG_ROLES.has(role)) return models.strong || worker;
  if (REVIEWER_ROLES.has(role)) return models.reviewer || worker;
  return worker;
}

/** Unique model slugs referenced by config (for preflight). */
export function listConfiguredModels(config) {
  const models = config?.models || {};
  const roles = [
    "planner", "worker", "merger", "reviewer", "strong",
    "adjudicator", "cluster", "decomposer", "repair-strong", "overfit-reviewer",
    "swarm-planner", "splitter", "review-diff", "review-codebase", "review-spec",
  ];
  const set = new Set();
  for (const role of roles) set.add(resolveModel(config, role));
  for (const v of Object.values(models)) {
    if (typeof v === "string" && v) set.add(v);
  }
  return [...set];
}

export function loadConfig(overrides = {}) {
  const raw = JSON.parse(readFileSync(path.join(ROOT, "config.json"), "utf8"));
  const merged = {
    ...raw,
    ...overrides,
    models: { ...raw.models, ...(overrides.models || {}) },
  };
  merged.repair = normalizeRepair({ ...raw, ...overrides, repair: overrides.repair || raw.repair });
  merged.holdout = normalizeHoldout({ ...raw, ...overrides, holdout: overrides.holdout || raw.holdout });
  merged.swarm = normalizeSwarm({
    ...raw,
    ...overrides,
    swarm: { ...(raw.swarm || {}), ...(overrides.swarm || {}) },
  });
  return merged;
}

export function projectRoot() {
  return ROOT;
}
