import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  abortMerge,
  commitAll,
  filesChangedSince,
  findConflictMarkers,
  headSha,
  listConflictFiles,
  mergeBranch,
  readDesign,
  resetHard,
} from "./lib/git.mjs";
import { buildMergerPrompt } from "./lib/prompts.mjs";
import { agentUsage, spawnAgent } from "./runner.mjs";

function safeGitStatus(cwd) {
  try {
    return execFileSync("git", ["status"], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    });
  } catch (err) {
    return `(git status failed: ${err.message || err})`;
  }
}

/** Source files over the line budget (S-A-008 oversized-file gate). */
export function findOversizedFiles(dir, files, maxLines) {
  if (!maxLines || maxLines <= 0) return [];
  const hits = [];
  for (const rel of files || []) {
    const n = rel.replace(/\\/g, "/");
    if (!n.startsWith("src/") || !/\.(ts|js|mjs)$/.test(n)) continue;
    if (n.endsWith(".d.ts")) continue;
    const p = path.join(dir, rel);
    if (!existsSync(p)) continue;
    try {
      const lines = readFileSync(p, "utf8").split("\n").length;
      if (lines > maxLines) hits.push({ file: rel, lines });
    } catch { /* skip */ }
  }
  return hits;
}

/**
 * Serial FIFO merge queue with conflict handling and conflict-marker gate.
 */
export class MergeQueue {
  constructor({
    mainDir,
    config,
    runDir,
    metrics,
    coordination,
    resolveWithMerger,
  }) {
    this.mainDir = mainDir;
    this.config = config;
    this.runDir = runDir;
    this.metrics = metrics;
    this.coordination = coordination;
    this.resolveWithMerger = resolveWithMerger;
    this.queue = [];
    this.processing = false;
  }

  enqueue(item) {
    return new Promise((resolve, reject) => {
      this.queue.push({ ...item, enqueuedAt: Date.now(), resolve, reject });
      this._pump();
    });
  }

  /**
   * Serialize an arbitrary main-workspace mutation through the same FIFO
   * as merges (e.g. planner writing DESIGN.md while merger may be active).
   */
  enqueueFn(fn, label = "fn") {
    return new Promise((resolve, reject) => {
      this.queue.push({
        fn,
        taskId: label,
        enqueuedAt: Date.now(),
        resolve,
        reject,
      });
      this._pump();
    });
  }

  async _pump() {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length) {
      const item = this.queue.shift();
      const waitMs = item.enqueuedAt != null ? Date.now() - item.enqueuedAt : 0;
      this.metrics.recordMergeWait?.({ taskId: item.taskId, waitMs, label: item.fn ? "fn" : "merge" });
      try {
        if (typeof item.fn === "function") {
          item.resolve(await item.fn());
          continue;
        }
        const result = await this._mergeOne(item);
        if (result.ok && item.afterMerge) {
          result.postMerge = await item.afterMerge();
        }
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      }
    }
    this.processing = false;
  }

  _changedFiles(preSha) {
    return filesChangedSince(this.mainDir, preSha);
  }

  _markerHits(preSha, extraFiles = []) {
    const files = [...new Set([...(extraFiles || []), ...this._changedFiles(preSha)])];
    return findConflictMarkers(this.mainDir, files);
  }

  _oversizedGate(preSha, taskId) {
    const maxLines = this.config.swarm?.oversizedFileLines
      ?? this.config.oversizedFileLines
      ?? 0;
    if (!maxLines) return null;
    const changed = this._changedFiles(preSha);
    const oversized = findOversizedFiles(this.mainDir, changed, maxLines);
    if (!oversized.length) return null;
    this.metrics.recordMergeGateRejection?.({
      taskId,
      files: oversized.map((o) => o.file),
      phase: "oversized",
    });
    if (typeof this.metrics.recordOversizedBlock === "function") {
      this.metrics.recordOversizedBlock({ taskId, files: oversized });
    }
    resetHard(this.mainDir, preSha);
    return {
      ok: false,
      conflict: false,
      oversized: true,
      oversized_files: oversized,
      taskId,
      gate: "oversized",
    };
  }

  async _resolveLoop({
    preSha,
    taskId,
    branch,
    workerRole,
    initialFiles,
    initialContext,
  }) {
    const designMd = readDesign(this.mainDir);
    const maxRetries = this.config.maxMergeRetries ?? 2;
    let conflictContext = initialContext;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      const role = this.coordination && this.resolveWithMerger ? "merger" : workerRole;
      const prompt = this.coordination && this.resolveWithMerger
        ? buildMergerPrompt({ conflictContext, designMd })
        : `${conflictContext}\n\nResolve the merge conflict in this workspace. Stage and commit when done. Say WORKER_DONE when finished.`;

      const agentResult = await spawnAgent({
        role,
        prompt,
        cwd: this.mainDir,
        config: this.config,
        runDir: this.runDir,
        logKey: `${role}-${taskId}-merge-${attempt}`,
        timeoutMs: (this.config.taskTimeoutMinutes || 20) * 60 * 1000,
      });
      this.metrics.recordAgentCall({
        role,
        taskId,
        phase: "merge-resolve",
        attempt,
        ok: agentResult.ok,
        ...agentUsage(agentResult),
      });

      const stillConflict = listConflictFiles(this.mainDir);
      if (stillConflict.length) {
        conflictContext = [
          `Merge conflict still open for task ${taskId} (branch ${branch}).`,
          `Unmerged files: ${stillConflict.join(", ")}`,
          "",
          "Git status:",
          safeGitStatus(this.mainDir),
        ].join("\n");
        continue;
      }

      // Ensure any staged resolution is committed.
      commitAll(this.mainDir, "merge: resolve conflict");

      const hits = this._markerHits(preSha, initialFiles);
      if (hits.length) {
        const marked = hits.map((h) => h.file);
        this.metrics.recordMergeGateRejection({ taskId, files: marked, attempt });
        conflictContext = [
          `Merge appears resolved in git but CONFLICT MARKERS remain in: ${marked.join(", ")}.`,
          "Reconcile both sides' intent, remove every <<<<<<< / >>>>>>> / ||||||| marker,",
          "keep the build green, stage and commit. Do not leave markers in the tree.",
          "",
          "Git status:",
          safeGitStatus(this.mainDir),
        ].join("\n");
        continue;
      }

      const oversized = this._oversizedGate(preSha, taskId);
      if (oversized) return oversized;
      return { ok: true, conflict: true, resolved: true, taskId, attempt };
    }

    // Retries exhausted — hard-reset to pre-merge state (abort may be invalid if already committed).
    resetHard(this.mainDir, preSha);
    return { ok: false, conflict: true, resolved: false, taskId, gate: "conflict-markers" };
  }

  async _mergeOne({ branch, taskId, workerRole = "worker" }) {
    const preSha = headSha(this.mainDir);
    const mergeResult = mergeBranch(this.mainDir, branch);

    if (mergeResult.ok) {
      const hits = this._markerHits(preSha);
      if (!hits.length) {
        const oversized = this._oversizedGate(preSha, taskId);
        if (oversized) return oversized;
        return { ok: true, conflict: false, taskId };
      }
      const marked = hits.map((h) => h.file);
      this.metrics.recordMergeGateRejection({ taskId, files: marked, phase: "clean-merge" });
      const initialContext = [
        `Merge of branch ${branch} for task ${taskId} completed in git, but CONFLICT MARKERS remain in: ${marked.join(", ")}.`,
        "Reconcile both sides' intent, remove every <<<<<<< / >>>>>>> / ||||||| marker,",
        "keep the build green, stage and commit. Do not leave markers in the tree.",
        "",
        "Git status:",
        safeGitStatus(this.mainDir),
      ].join("\n");
      return this._resolveLoop({
        preSha,
        taskId,
        branch,
        workerRole,
        initialFiles: marked,
        initialContext,
      });
    }

    if (!mergeResult.conflict) {
      return { ok: false, conflict: false, taskId, message: mergeResult.message };
    }

    const files = listConflictFiles(this.mainDir);
    this.metrics.recordMergeConflict({ taskId, branch, files });

    const initialContext = [
      `Merge conflict merging branch ${branch} for task ${taskId}.`,
      `Conflict files: ${files.join(", ") || "(unknown)"}`,
      "",
      "Git status:",
      safeGitStatus(this.mainDir),
    ].join("\n");

    return this._resolveLoop({
      preSha,
      taskId,
      branch,
      workerRole,
      initialFiles: files,
      initialContext,
    });
  }
}

// Side effects of the required build step (npm install / tsc), not code edits.
const SCOPE_EXEMPT = new Set(["GUIDE.md", "package-lock.json", "npm-shrinkwrap.json"]);

// Living design / compile-checked contracts (faithful mode).
const CROSS_SCOPE_DOC_FILES = new Set(["DESIGN.md", "src/contracts.ts"]);

export function checkScopeViolation(changedFiles, allowedScope, { allowDesign = false } = {}) {
  const allowed = new Set(allowedScope || []);
  return changedFiles.filter(
    (f) => !allowed.has(f)
      && !SCOPE_EXEMPT.has(f)
      && !(allowDesign && CROSS_SCOPE_DOC_FILES.has(f))
      && !f.startsWith("dist/"),
  );
}
