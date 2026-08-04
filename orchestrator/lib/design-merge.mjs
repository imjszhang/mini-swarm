/**
 * Three-way merge for DESIGN.md writes (v13.7).
 * Prevents planner full-replace from clobbering worker interface updates.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * @param {{ base: string, ours: string, theirs: string }} input
 * @returns {{ merged: string|null, conflict: boolean, summary?: string }}
 */
export function mergeDesign({ base, ours, theirs } = {}) {
  const b = String(base ?? "");
  const o = String(ours ?? "");
  const t = String(theirs ?? "");

  // Fast paths — no subprocess needed.
  if (o === b) {
    return { merged: t, conflict: false };
  }
  if (t === b) {
    return { merged: o, conflict: false };
  }
  if (o === t) {
    return { merged: o, conflict: false };
  }

  const dir = mkdtempSync(path.join(tmpdir(), "mini-swarm-design-"));
  const basePath = path.join(dir, "base.md");
  const oursPath = path.join(dir, "ours.md");
  const theirsPath = path.join(dir, "theirs.md");
  try {
    writeFileSync(basePath, b, "utf8");
    writeFileSync(oursPath, o, "utf8");
    writeFileSync(theirsPath, t, "utf8");
    const result = spawnSync(
      "git",
      ["merge-file", "-p", oursPath, basePath, theirsPath],
      { encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    );
    // git merge-file: 0 = clean, 1 = conflicts, >1 = error
    const status = result.status;
    const out = String(result.stdout || "");
    if (status === 0) {
      return { merged: out, conflict: false };
    }
    if (status === 1) {
      const markers = (out.match(/^<<<<<<< /gm) || []).length;
      return {
        merged: null,
        conflict: true,
        summary: `DESIGN.md three-way merge conflict (${markers} hunk(s)); kept main workspace version. Re-emit design_md next round if still needed.`,
      };
    }
    return {
      merged: null,
      conflict: true,
      summary: `DESIGN.md merge-file failed (exit ${status}): ${String(result.stderr || "").slice(0, 200)}`,
    };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
