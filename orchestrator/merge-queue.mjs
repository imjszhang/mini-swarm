import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  abortMerge,
  getDiff,
  listConflictFiles,
  mergeBranch,
} from "./lib/git.mjs";
import { buildMergerPrompt } from "./lib/prompts.mjs";
import { spawnAgent } from "./runner.mjs";

/**
 * Serial FIFO merge queue with conflict handling.
 */
export class MergeQueue {
  constructor({
    mainDir,
    config,
    runDir,
    metrics,
    coordination,
    designMd,
    resolveWithMerger,
  }) {
    this.mainDir = mainDir;
    this.config = config;
    this.runDir = runDir;
    this.metrics = metrics;
    this.coordination = coordination;
    this.designMd = designMd;
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
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      }
    }
    this.processing = false;
  }

  async _mergeOne({ branch, taskId, workerDir, workerRole = "worker" }) {
    const mergeResult = mergeBranch(this.mainDir, branch);
    if (mergeResult.ok) {
      return { ok: true, conflict: false, taskId };
    }
    if (!mergeResult.conflict) {
      return { ok: false, conflict: false, taskId, message: mergeResult.message };
    }

    const files = listConflictFiles(this.mainDir);
    this.metrics.recordConflict({ taskId, branch, files });

    const conflictContext = [
      `Merge conflict merging branch ${branch} for task ${taskId}.`,
      `Conflict files: ${files.join(", ") || "(unknown)"}`,
      "",
      "Git status:",
      execSync("git status", { cwd: this.mainDir, encoding: "utf8" }),
    ].join("\n");

    const maxRetries = this.config.maxMergeRetries ?? 2;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      const role = this.coordination && this.resolveWithMerger ? "merger" : workerRole;
      const prompt = this.coordination && this.resolveWithMerger
        ? buildMergerPrompt({ conflictContext, designMd: this.designMd })
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
        elapsedMs: agentResult.elapsedMs,
      });

      const stillConflict = listConflictFiles(this.mainDir);
      if (!stillConflict.length) {
        try {
          execSync("git diff --cached --quiet", { cwd: this.mainDir, stdio: "pipe" });
        } catch {
          try {
            execSync("git commit -m \"merge: resolve conflict\"", { cwd: this.mainDir, stdio: "pipe" });
          } catch {
            /* may already be committed */
          }
        }
        return { ok: true, conflict: true, resolved: true, taskId, attempt };
      }
    }

    abortMerge(this.mainDir);
    return { ok: false, conflict: true, resolved: false, taskId };
  }
}

export function checkScopeViolation(changedFiles, allowedScope) {
  const allowed = new Set(allowedScope || []);
  return changedFiles.filter((f) => !allowed.has(f) && f !== "GUIDE.md");
}
