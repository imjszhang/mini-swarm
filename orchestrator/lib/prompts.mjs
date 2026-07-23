import { readFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./config.mjs";

export function loadPrompt(name) {
  return readFileSync(path.join(projectRoot(), "prompts", `${name}.md`), "utf8");
}

export function fillTemplate(template, vars) {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value ?? "");
  }
  return out;
}

export function buildPlannerPrompt({ coordination }) {
  const rules = coordination
    ? `- **Coordination ON**: Write \`DESIGN.md\` first (module interfaces, data structures, file layout).
- \`files_scope\` MUST be pairwise disjoint across tasks (no overlapping paths).
- Initialize \`GUIDE.md\` with a short header (project tips for future workers).`
    : `- **Coordination OFF**: No DESIGN.md required. Overlapping files_scope allowed (conflicts expected).`;
  return fillTemplate(loadPrompt("planner"), {
    COORDINATION_RULES: rules,
  });
}

export function buildWorkerPrompt({ task, designMd, guideMd }) {
  return fillTemplate(loadPrompt("worker"), {
    TASK_JSON: JSON.stringify(task, null, 2),
    TASK_ID: task.id,
    DESIGN_MD: designMd || "_None._",
    GUIDE_MD: guideMd || "_Empty._",
  });
}

export function buildMergerPrompt({ conflictContext, designMd }) {
  return fillTemplate(loadPrompt("merger"), {
    CONFLICT_CONTEXT: conflictContext,
    DESIGN_MD: designMd || "_None._",
  });
}

export function buildReviewerPrompt({ diff, scoreSnapshot }) {
  return fillTemplate(loadPrompt("reviewer"), {
    DIFF: diff,
    SCORE_SNAPSHOT: scoreSnapshot,
  });
}
