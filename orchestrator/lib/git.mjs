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

export function createWorktree(mainDir, worktreesRoot, taskId) {
  const branch = `task/${taskId}`;
  const wtPath = path.join(worktreesRoot, taskId);

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
