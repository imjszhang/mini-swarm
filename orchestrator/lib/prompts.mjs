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
- Initialize \`GUIDE.md\` with a short header (project tips for future workers).
- **Integration / wiring**: If workers must hook modules into a shared orchestrator (e.g. \`src/index.ts\`, \`src/blocks/index.ts\`, barrel \`index.ts\` files), either (1) put that path in **this task's** \`files_scope\` when the task owns the wiring, or (2) add a **final dedicated task** (e.g. "Wire block parsers into orchestrator") whose \`files_scope\` is only those integration files, after all parser tasks.
- **Notes discipline**: Never tell a worker in \`notes\` to edit or "register in" a file that is **not** in that task's \`files_scope\`. Parser tasks should say "export API from this module; wiring task integrates" instead.`
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
