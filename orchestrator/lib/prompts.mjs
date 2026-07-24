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

export function buildPlannerPrompt({ coordination, coordMode = "strict" }) {
  const strictRules = `- **Coordination ON (strict)**: Write \`DESIGN.md\` first (module interfaces, data structures, file layout).
- \`files_scope\` MUST be pairwise disjoint across tasks (no overlapping paths).
- Initialize \`GUIDE.md\` with a short header (project tips for future workers).
- **Integration / wiring**: If workers must hook modules into a shared orchestrator (e.g. \`src/index.ts\`, \`src/blocks/index.ts\`, barrel \`index.ts\` files), either (1) put that path in **this task's** \`files_scope\` when the task owns the wiring, or (2) add a **final dedicated task** (e.g. "Wire block parsers into orchestrator") whose \`files_scope\` is only those integration files, after all parser tasks.
- **Notes discipline**: Never tell a worker in \`notes\` to edit or "register in" a file that is **not** in that task's \`files_scope\`. Parser tasks should say "export API from this module; wiring task integrates" instead.`;
  const faithfulRules = `- **Coordination ON (faithful)**: Write \`DESIGN.md\` first with module interfaces, shared data structures, integration points, and decision rationale.
- \`files_scope\` paths define primary ownership, not a hard wall. Keep them pairwise disjoint, but workers may make a minimal targeted cross-scope patch when integration or a core design change requires it.
- Do not force all integration into one final wiring task. Each task should integrate its feature when practical; shared integration files may be patched with an explicit justification.
- Initialize \`GUIDE.md\` with a short header. Workers may append surprising findings for successors.
- DESIGN.md is a living document. A worker that changes an interface or design decision must update the relevant section so later workers receive the new reality.
- DESIGN.md interface definitions live in \`src/contracts.ts\` and are compile-checked; if you change an interface, update \`contracts.ts\` and DESIGN.md together.
- Notes may mention a shared integration file outside primary scope only when they explicitly require a minimal cross-scope patch and explain why.`;
  const rules = coordination
    ? (coordMode === "faithful" ? faithfulRules : strictRules)
    : `- **Coordination OFF**: No DESIGN.md required. Overlapping files_scope allowed (conflicts expected).`;
  return fillTemplate(loadPrompt("planner"), {
    COORDINATION_RULES: rules,
  });
}

export function buildWorkerPrompt({ task, designMd, guideMd, coordMode = "strict" }) {
  const modeRules = coordMode === "faithful"
    ? `- Treat \`files_scope\` as your primary ownership area.
- If integration or a core design correction genuinely requires another file, make the smallest targeted cross-scope patch and add \`cross-scope: <reason>\` to the commit message.
- If you change an interface or design decision, update the relevant section of DESIGN.md. Do not rewrite unrelated design decisions.
- DESIGN.md interface definitions live in \`src/contracts.ts\` and are compile-checked; if you change an interface, update \`contracts.ts\` and DESIGN.md together.
- Append only surprising, reusable findings to GUIDE.md.`
    : `- Only modify files listed in \`files_scope\` for this task (plus \`GUIDE.md\` append-only).
- If task notes mention editing a file outside \`files_scope\`, ignore that instruction — scope wins.`;
  return fillTemplate(loadPrompt("worker"), {
    TASK_JSON: JSON.stringify(task, null, 2),
    TASK_ID: task.id,
    DESIGN_MD: designMd || "_None._",
    GUIDE_MD: guideMd || "_Empty._",
    COORDINATION_MODE_RULES: modeRules,
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

export function buildIntegrationFixPrompt({ buildError, designMd, diff }) {
  return fillTemplate(loadPrompt("integration-fix"), {
    BUILD_ERROR: buildError || "(no stderr captured)",
    DESIGN_MD: designMd || "_None._",
    DIFF: diff || "_No diff available._",
  });
}
