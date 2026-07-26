import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function git(cwd, args, opts = {}) {
  const quoted = args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a));
  return execSync(`git ${quoted.join(" ")}`, {
    cwd,
    encoding: "utf8",
    stdio: opts.stdio || "pipe",
    shell: true,
    ...opts,
  }).trim();
}

export function initRepo(workspaceDir) {
  if (!existsSync(path.join(workspaceDir, ".git"))) {
    git(workspaceDir, ["init"]);
    git(workspaceDir, ["checkout", "-b", "main"]);
    writeFileSync(path.join(workspaceDir, "README.md"), "# mini-swarm workspace\n", "utf8");
    git(workspaceDir, ["add", "-A"]);
    git(workspaceDir, ["commit", "-m", "init"]);
  }
}

export function commitCount(workspaceDir) {
  try {
    return Number(git(workspaceDir, ["rev-list", "--count", "HEAD"])) || 0;
  } catch {
    return 0;
  }
}

export function getDiff(workspaceDir, ref = "HEAD~1") {
  try {
    return git(workspaceDir, ["diff", ref, "HEAD"]);
  } catch {
    try {
      return git(workspaceDir, ["diff", "HEAD"]);
    } catch {
      return "";
    }
  }
}

export function mergeBranch(mainDir, branchName) {
  try {
    git(mainDir, ["merge", branchName, "--no-edit"]);
    return { ok: true, conflict: false };
  } catch (err) {
    const msg = String(err.stderr || err.stdout || err.message || "");
    const conflict = /CONFLICT|conflict/i.test(msg);
    return { ok: false, conflict, message: msg };
  }
}

/**
 * Merge main into a worktree so the worker sees recent integrations.
 */
export function syncWorktreeWithMain(wtDir) {
  try {
    git(wtDir, ["merge", "main", "--no-edit"]);
    return { ok: true, conflict: false, files: [] };
  } catch (err) {
    const msg = String(err.stderr || err.stdout || err.message || "");
    const conflict = /CONFLICT|conflict/i.test(msg);
    return {
      ok: false,
      conflict,
      files: conflict ? listConflictFiles(wtDir) : [],
      message: msg,
    };
  }
}

export function headSha(dir) {
  try {
    return git(dir, ["rev-parse", "HEAD"]);
  } catch {
    return null;
  }
}

/**
 * Scan files for leftover git conflict markers (<<<<<<< / >>>>>>> / |||||||).
 * Deliberately skips ======= to avoid CommonMark setext-heading false positives.
 */
export function findConflictMarkers(dir, files) {
  const hits = [];
  for (const rel of files || []) {
    const p = path.join(dir, rel);
    if (!existsSync(p)) continue;
    let text;
    try {
      text = readFileSync(p, "utf8");
    } catch {
      continue;
    }
    let count = 0;
    for (const line of text.split("\n")) {
      if (
        line.startsWith("<<<<<<<")
        || line.startsWith(">>>>>>>")
        || line.startsWith("|||||||")
      ) {
        count += 1;
      }
    }
    if (count > 0) hits.push({ file: rel, count });
  }
  return hits;
}

export function filesChangedSince(dir, sha) {
  if (!sha) return [];
  try {
    const out = git(dir, ["diff", "--name-only", sha, "HEAD"]);
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function resetHard(dir, sha) {
  if (!sha) return;
  try {
    git(dir, ["reset", "--hard", sha]);
  } catch {
    /* ignore */
  }
}

export function commitAll(dir, message) {
  try {
    git(dir, ["add", "-A"]);
    try {
      execSync("git diff --cached --quiet", { cwd: dir, stdio: "pipe", shell: true });
      return false; // nothing staged
    } catch {
      git(dir, ["commit", "-m", message]);
      return true;
    }
  } catch {
    return false;
  }
}

export function abortMerge(mainDir) {
  try {
    git(mainDir, ["merge", "--abort"]);
  } catch {
    /* ignore */
  }
}

export function listConflictFiles(mainDir) {
  try {
    const out = git(mainDir, ["diff", "--name-only", "--diff-filter=U"]);
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * @param {string} mainDir
 * @param {string} worktreesRoot
 * @param {string} taskId — directory name under worktreesRoot (and default branch suffix)
 * @param {{ branch?: string, dirName?: string }} [opts]
 */
export function createWorktree(mainDir, worktreesRoot, taskId, opts = {}) {
  const branch = opts.branch || `task/${taskId}`;
  const dirName = opts.dirName || taskId;
  const wtPath = path.join(worktreesRoot, dirName);

  if (existsSync(wtPath)) {
    try {
      git(mainDir, ["worktree", "remove", wtPath, "--force"]);
    } catch {
      /* ignore */
    }
  }
  try {
    git(mainDir, ["branch", "-D", branch]);
  } catch {
    /* branch may not exist */
  }

  git(mainDir, ["worktree", "add", "-b", branch, wtPath, "main"]);
  return { branch, path: wtPath };
}

export function listBranchesByPrefix(dir, prefix) {
  try {
    const out = git(dir, ["branch", "--list", `${prefix}*`, "--format=%(refname:short)"]);
    return out ? out.split("\n").map((s) => s.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function deleteBranchesByPrefix(dir, prefix) {
  for (const branch of listBranchesByPrefix(dir, prefix)) {
    try {
      git(dir, ["branch", "-D", branch]);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Merge a branch into main with --no-ff. Returns { ok, conflict, message }.
 */
export function mergeBranchNoFf(mainDir, branchName) {
  try {
    git(mainDir, ["merge", "--no-ff", branchName, "--no-edit"]);
    return { ok: true, conflict: false };
  } catch (err) {
    const msg = String(err.stderr || err.stdout || err.message || "");
    const conflict = /CONFLICT|conflict/i.test(msg);
    return { ok: false, conflict, message: msg };
  }
}

export function removeWorktree(mainDir, wtPath) {
  try {
    git(mainDir, ["worktree", "remove", wtPath, "--force"]);
  } catch {
    /* ignore */
  }
}

export function readGuide(workspaceDir) {
  const p = path.join(workspaceDir, "GUIDE.md");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

export function readDesign(workspaceDir) {
  const p = path.join(workspaceDir, "DESIGN.md");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

export function filesChangedInWorktree(wtDir) {
  try {
    const out = git(wtDir, ["diff", "--name-only", "main...HEAD"]);
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    try {
      const fallback = git(wtDir, ["diff", "--name-only", "main"]);
      return fallback ? fallback.split("\n").filter(Boolean) : [];
    } catch {
      return [];
    }
  }
}

/**
 * Approximate wasted-work / churn from git history.
 * Counts added/deleted lines for TypeScript under src/ across all commits (excludes dist/).
 * churn_ratio = total_deleted / max(total_added, 1).
 */
export function computeChurn(workspaceDir) {
  try {
    const out = execSync("git log --numstat --format=", {
      cwd: workspaceDir,
      encoding: "utf8",
      stdio: "pipe",
      shell: true,
    });
    let total_added = 0;
    let total_deleted = 0;
    for (const line of out.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split("\t");
      if (parts.length < 3) continue;
      const [addedStr, deletedStr, file] = parts;
      if (!file || !/^src\/.+\.ts$/.test(file.replace(/\\/g, "/"))) continue;
      if (addedStr === "-" || deletedStr === "-") continue;
      const added = Number(addedStr);
      const deleted = Number(deletedStr);
      if (!Number.isFinite(added) || !Number.isFinite(deleted)) continue;
      total_added += added;
      total_deleted += deleted;
    }
    return {
      total_added,
      total_deleted,
      churn_ratio: total_deleted / Math.max(total_added, 1),
    };
  } catch {
    return { total_added: 0, total_deleted: 0, churn_ratio: 0 };
  }
}

export function isDirty(dir) {
  try {
    const out = git(dir, ["status", "--porcelain"]);
    return Boolean(out && out.trim());
  } catch {
    return false;
  }
}

export function listTaskBranches(dir) {
  try {
    const out = git(dir, ["branch", "--list", "task/*", "--format=%(refname:short)"]);
    return out ? out.split("\n").map((s) => s.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function isBranchMergedInto(dir, branch, target = "main") {
  try {
    git(dir, ["merge-base", "--is-ancestor", branch, target]);
    return true;
  } catch {
    return false;
  }
}

export function deleteTaskBranches(dir) {
  for (const branch of listTaskBranches(dir)) {
    try {
      git(dir, ["branch", "-D", branch]);
    } catch {
      /* ignore */
    }
  }
}

export function revListCount(dir) {
  try {
    return Number(git(dir, ["rev-list", "--count", "HEAD"])) || 0;
  } catch {
    return 0;
  }
}

export function listTrackedFiles(dir) {
  try {
    const out = git(dir, ["ls-files"]);
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}
