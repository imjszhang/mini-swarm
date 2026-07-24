import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { projectRoot } from "./config.mjs";

/**
 * @param {string} workspaceDir
 * @param {string} jsonOut
 * @param {{ sections?: string[] }} [opts]
 */
export function runScore(workspaceDir, jsonOut, opts = {}) {
  const args = [
    path.join(projectRoot(), "scorer", "score.mjs"),
    "--workspace", workspaceDir,
    "--json", jsonOut,
  ];
  if (opts.sections?.length) {
    args.push("--sections", opts.sections.join(","));
  }
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });

  let report = null;
  try {
    report = JSON.parse(readFileSync(jsonOut, "utf8"));
  } catch {
    report = { rate: 0, passed: 0, total: 0, parse_error: true };
  }
  return { ok: result.status === 0, report, stdout: result.stdout, stderr: result.stderr };
}
