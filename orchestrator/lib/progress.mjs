import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export function progressPath(runDir) {
  return path.join(runDir, "progress.json");
}

export function loadProgress(runDir) {
  const p = progressPath(runDir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Atomically persist progress (write tmp then rename).
 */
export function saveProgress(runDir, progress) {
  const next = { ...progress, updated_at: new Date().toISOString() };
  const p = progressPath(runDir);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  renameSync(tmp, p);
  Object.assign(progress, next);
  return progress;
}

export function createInitialProgress({ runId, fingerprint, tasks }) {
  const taskMap = {};
  for (const t of tasks || []) {
    if (t?.id) taskMap[t.id] = "pending";
  }
  return {
    run_id: runId,
    phase: "tasks",
    fingerprint: { ...fingerprint },
    tasks: taskMap,
    global_repair_rounds_done: 0,
    generalization_rounds_done: 0,
    segments: [{ started_at: new Date().toISOString() }],
    updated_at: new Date().toISOString(),
  };
}

export function markTask(runDir, progress, taskId, status) {
  if (!progress) return null;
  progress.tasks = progress.tasks || {};
  progress.tasks[taskId] = status;
  return saveProgress(runDir, progress);
}

export function markPhase(runDir, progress, phase) {
  if (!progress) return null;
  progress.phase = phase;
  return saveProgress(runDir, progress);
}

export function markRepairRound(runDir, progress, r) {
  if (!progress) return null;
  progress.global_repair_rounds_done = r;
  return saveProgress(runDir, progress);
}

export function markGeneralizationRound(runDir, progress, r) {
  if (!progress) return null;
  progress.generalization_rounds_done = r;
  return saveProgress(runDir, progress);
}
