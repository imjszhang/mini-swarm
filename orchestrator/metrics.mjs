import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export function createMetricsCollector(runDir) {
  const data = {
    started_at: new Date().toISOString(),
    finished_at: null,
    coordination: false,
    commits: 0,
    conflicts: [],
    conflict_count: 0,
    tasks: [],
    score_curve: [],
    agent_calls: [],
    loc: null,
    final_score: null,
  };

  return {
    data,
    recordAgentCall(entry) {
      data.agent_calls.push({ ...entry, at: new Date().toISOString() });
    },
    recordConflict(entry) {
      data.conflicts.push({ ...entry, at: new Date().toISOString() });
      data.conflict_count = data.conflicts.length;
    },
    recordTask(entry) {
      const idx = data.tasks.findIndex((t) => t.id === entry.id);
      if (idx >= 0) data.tasks[idx] = { ...data.tasks[idx], ...entry };
      else data.tasks.push(entry);
    },
    recordScore(point) {
      data.score_curve.push({ ...point, at: new Date().toISOString() });
    },
    setMeta(partial) {
      Object.assign(data, partial);
    },
    finish(extra = {}) {
      data.finished_at = new Date().toISOString();
      Object.assign(data, extra);
      const out = path.join(runDir, "metrics.json");
      writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      return out;
    },
  };
}

export function countLoc(workspaceDir) {
  let lines = 0;
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = statSync(p);
      if (st.isDirectory() && name !== "node_modules" && name !== "dist") walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(name) && !name.endsWith(".d.ts")) {
        lines += readFileSync(p, "utf8").split("\n").length;
      }
    }
  }
  const src = path.join(workspaceDir, "src");
  if (existsSync(src)) walk(src);
  return lines;
}
