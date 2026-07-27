import { execSync } from "node:child_process";
import {
  abortMerge,
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
      this.queue.push({ ...item, resolve, reject });
      this._pump();
    });
  }

  async _pump() {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length) {
      const item = this.queue.shift();
      try {
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
          execSync("git status", { cwd: this.mainDir, encoding: "utf8" }),
        ].join("\n");
        continue;
      }

      // Ensure any staged resolution is committed.
      try {
        execSync("git diff --cached --quiet", { cwd: this.mainDir, stdio: "pipe" });
      } catch {
        try {
          execSync("git commit -m \"merge: resolve conflict\"", { cwd: this.mainDir, stdio: "pipe" });
        } catch {
          /* may already be committed */
        }
      }

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
          execSync("git status", { cwd: this.mainDir, encoding: "utf8" }),
        ].join("\n");
        continue;
      }

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
        execSync("git status", { cwd: this.mainDir, encoding: "utf8" }),
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
      execSync("git status", { cwd: this.mainDir, encoding: "utf8" }),
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
