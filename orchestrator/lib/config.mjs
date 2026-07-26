import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function normalizeRepair(raw) {
  if (raw.repair && typeof raw.repair === "object") {
    return {
      maxRounds: raw.repair.maxRounds ?? 4,
      target: raw.repair.target ?? 1.0,
      exhaustiveThreshold: raw.repair.exhaustiveThreshold ?? 24,
      topGroups: raw.repair.topGroups ?? 3,
      maxClusters: raw.repair.maxClusters ?? 8,
      candidates: raw.repair.candidates ?? 2,
      minGainItems: raw.repair.minGainItems ?? 1,
      maxPhaseMinutes: raw.repair.maxPhaseMinutes ?? 90,
      stuckThreshold: raw.repair.stuckThreshold ?? 2,
    };
  }
  // Compat: synthesize from legacy v10 keys.
  return {
    maxRounds: raw.maxGlobalRepairRounds ?? 2,
    target: raw.globalRepairTarget ?? 1.0,
    exhaustiveThreshold: 24,
    topGroups: raw.globalRepairTopSections ?? 3,
    maxClusters: 8,
    candidates: 2,
    minGainItems: 1,
    maxPhaseMinutes: 90,
    stuckThreshold: 2,
  };
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

export function loadConfig(overrides = {}) {
  const raw = JSON.parse(readFileSync(path.join(ROOT, "config.json"), "utf8"));
  const merged = {
    ...raw,
    ...overrides,
    models: { ...raw.models, ...(overrides.models || {}) },
  };
  merged.repair = normalizeRepair({ ...raw, ...overrides, repair: overrides.repair || raw.repair });
  merged.holdout = normalizeHoldout({ ...raw, ...overrides, holdout: overrides.holdout || raw.holdout });
  return merged;
}

export function projectRoot() {
  return ROOT;
}
