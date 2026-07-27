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

export function buildPlannerPrompt({ coordination, coordMode = "strict", contentionReportText = "" }) {
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
  let rules = coordination
    ? (coordMode === "faithful" ? faithfulRules : strictRules)
    : `- **Coordination OFF**: No DESIGN.md required. Overlapping files_scope allowed (conflicts expected).`;
  if (contentionReportText) {
    rules += `\n\n## Historical high-contention files (from prior runs)\n\n${contentionReportText}\n\nConsider splitting ownership of hot files or adding a dedicated wiring task.`;
  }
  return fillTemplate(loadPrompt("planner"), {
    COORDINATION_RULES: rules,
  });
}

function coordinationModeRules(coordMode) {
  return coordMode === "faithful"
    ? `- Treat \`files_scope\` as your primary ownership area.
- If integration or a core design correction genuinely requires another file, make the smallest targeted cross-scope patch and add \`cross-scope: <reason>\` to the commit message.
- If you change an interface or design decision, update the relevant section of DESIGN.md. Do not rewrite unrelated design decisions.
- DESIGN.md interface definitions live in \`src/contracts.ts\` and are compile-checked; if you change an interface, update \`contracts.ts\` and DESIGN.md together.
- Append only surprising, reusable findings to GUIDE.md.`
    : `- Only modify files listed in \`files_scope\` for this task (plus \`GUIDE.md\` append-only).
- If task notes mention editing a file outside \`files_scope\`, ignore that instruction — scope wins.`;
}

function repairCoordinationRules(coordMode) {
  return coordMode === "faithful"
    ? `- If you change an interface or design decision, update the relevant section of DESIGN.md.
- DESIGN.md interface definitions live in \`src/contracts.ts\` and are compile-checked; if you change an interface, update \`contracts.ts\` and DESIGN.md together.
- Append only surprising, reusable findings to GUIDE.md.`
    : `- No scope restrictions for this repair; edit whatever the root cause requires.`;
}

export function buildWorkerPrompt({ task, designMd, guideMd, coordMode = "strict", verifyCmd = "" }) {
  return fillTemplate(loadPrompt("worker"), {
    TASK_JSON: JSON.stringify(task, null, 2),
    TASK_ID: task.id,
    DESIGN_MD: designMd || "_None._",
    GUIDE_MD: guideMd || "_Empty._",
    COORDINATION_MODE_RULES: coordinationModeRules(coordMode),
    VERIFY_CMD: verifyCmd || "_No verification command configured._",
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

function truncate(text, max = 300) {
  const s = String(text ?? "");
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

export function formatScoreFailures(failures, max = 8) {
  const items = (failures || []).slice(0, max);
  if (!items.length) return "_No failure details available._";
  return items.map((f, i) => {
    const group = f.group || f.section || "?";
    const input = f.input ?? f.markdown;
    const lines = [
      `### Failure ${i + 1}: ${f.id || "?"} [${group}]`,
      `Reason: ${f.reason || "unknown"}`,
    ];
    if (input != null) lines.push(`IN:\n\`\`\`\n${truncate(input, 2000)}\n\`\`\``);
    if (f.expected != null) lines.push(`EXP:\n\`\`\`\n${truncate(f.expected, 2000)}\n\`\`\``);
    if (f.actual != null) lines.push(`GOT:\n\`\`\`\n${truncate(f.actual, 2000)}\n\`\`\``);
    if (input == null && f.expected == null && f.reason) {
      lines.push(`Detail: ${truncate(f.reason, 500)}`);
    }
    return lines.join("\n");
  }).join("\n\n");
}

export function buildWorkerScoreFixPrompt({
  task,
  sections,
  rate,
  failures,
  coordMode = "strict",
  buildError = null,
  verifyCmd = "",
}) {
  let failureBlock = formatScoreFailures(failures, 8);
  if (buildError) {
    failureBlock = `### Build failed\n\`\`\`\n${truncate(buildError, 1500)}\n\`\`\`\n\n${failureBlock}`;
  }

  return fillTemplate(loadPrompt("worker-score-fix"), {
    TASK_JSON: JSON.stringify(task, null, 2),
    SECTIONS: (sections || task.spec_sections || []).join(", ") || "(none)",
    RATE: typeof rate === "number" ? `${(rate * 100).toFixed(1)}%` : String(rate ?? "n/a"),
    FAILURES: failureBlock,
    COORDINATION_MODE_RULES: coordinationModeRules(coordMode),
    VERIFY_CMD: verifyCmd || "_No verification command configured._",
  });
}

export function buildAdjudicatePrompt({ items }) {
  const block = (items || []).map((it, i) => {
    return [
      `### Item ${i + 1}: ${it.id} [${it.group || "?"}]`,
      `IN:\n\`\`\`\n${truncate(it.input, 2000)}\n\`\`\``,
      `EXP:\n\`\`\`\n${truncate(it.expected, 2000)}\n\`\`\``,
      `GOT:\n\`\`\`\n${truncate(it.actual, 2000)}\n\`\`\``,
      `Normative reference excerpt:\n\`\`\`\n${truncate(it.reference, 2000)}\n\`\`\``,
    ].join("\n");
  }).join("\n\n") || "_No items._";

  return fillTemplate(loadPrompt("adjudicate"), { ITEMS: block });
}

export function buildClusterPrompt({ failures, maxClusters }) {
  return fillTemplate(loadPrompt("cluster"), {
    FAILURES: formatScoreFailures(failures, 40),
    MAX_CLUSTERS: String(maxClusters ?? 8),
  });
}

export function buildRepairClusterPrompt({
  rate,
  clusterId,
  hypothesis,
  failures,
  reference,
  verifyCmd,
  coordMode = "strict",
  lessons = "",
  designNote = "",
  strategySuffix = "",
}) {
  let body = fillTemplate(loadPrompt("repair-cluster"), {
    RATE: typeof rate === "number" ? `${(rate * 100).toFixed(1)}%` : String(rate ?? "n/a"),
    CLUSTER_ID: clusterId || "?",
    HYPOTHESIS: hypothesis || "_unspecified_",
    FAILURES: formatScoreFailures(failures, 40),
    REFERENCE: reference || "_None available._",
    VERIFY_CMD: verifyCmd || "_No verification command configured._",
    COORDINATION_MODE_RULES: repairCoordinationRules(coordMode),
    LESSONS: lessons || "_None yet._",
  });
  if (designNote) {
    body += `\n\n## Design note from decomposer\n\n${designNote}\n`;
  }
  if (strategySuffix) {
    body += `\n\n## Candidate strategy\n\n${strategySuffix}\n`;
  }
  return body;
}

export function buildRepairBlindPrompt({
  rate,
  group,
  failCount,
  reference,
  verifyGenCmd,
  verifyVisibleCmd,
  coordMode = "strict",
  lessons = "",
  strategySuffix = "",
}) {
  let body = fillTemplate(loadPrompt("repair-blind"), {
    RATE: typeof rate === "number" ? `${(rate * 100).toFixed(1)}%` : String(rate ?? "n/a"),
    GROUP: group || "?",
    FAIL_COUNT: String(failCount ?? 0),
    REFERENCE: reference || "_None available._",
    VERIFY_GEN_CMD: verifyGenCmd || "_No generated checks configured._",
    VERIFY_VISIBLE_CMD: verifyVisibleCmd || "_No verification command configured._",
    COORDINATION_MODE_RULES: repairCoordinationRules(coordMode),
    LESSONS: lessons || "_None yet._",
  });
  if (strategySuffix) {
    body += `\n\n## Candidate strategy\n\n${strategySuffix}\n`;
  }
  return body;
}

export function buildDecomposePrompt({
  clusterId,
  hypothesis,
  itemCount,
  failures,
  reference,
}) {
  return fillTemplate(loadPrompt("decompose"), {
    CLUSTER_ID: clusterId || "?",
    HYPOTHESIS: hypothesis || "_unspecified_",
    ITEM_COUNT: String(itemCount ?? 0),
    FAILURES: formatScoreFailures(failures, 40),
    REFERENCE: reference || "_None available._",
  });
}

export function buildOverfitReviewPrompt({ diff }) {
  return fillTemplate(loadPrompt("overfit-review"), {
    DIFF: truncate(diff, 8000) || "_Empty diff._",
  });
}

export function buildSwarmPlannerPrompt({
  specToc,
  treeSummary,
  designMd,
  guideIndex,
  workerReports,
  reviewFindings,
  coverage,
  actionErrors,
  budgetLine,
  fanoutTarget,
  maxTreeDepth,
}) {
  return fillTemplate(loadPrompt("swarm-planner"), {
    SPEC_TOC: specToc || "_None._",
    TREE_SUMMARY: treeSummary || "_Empty._",
    DESIGN_MD: designMd || "_None._",
    GUIDE_INDEX: guideIndex || "_Empty._",
    WORKER_REPORTS: workerReports || "_None yet._",
    REVIEW_FINDINGS: reviewFindings || "_None yet._",
    COVERAGE: coverage || "_None._",
    ACTION_ERRORS: actionErrors || "_None._",
    BUDGET_LINE: budgetLine || "_None._",
    FANOUT_TARGET: String(fanoutTarget ?? 8),
    MAX_TREE_DEPTH: String(maxTreeDepth ?? 2),
  });
}

export function buildSwarmWorkerPrompt({
  task,
  specText,
  designMd,
  guideIndex,
  oversizedLines,
}) {
  return fillTemplate(loadPrompt("swarm-worker"), {
    TASK_JSON: JSON.stringify(task, null, 2),
    SPEC_TEXT: specText || "_No sections assigned._",
    DESIGN_MD: designMd || "_None._",
    GUIDE_INDEX: guideIndex || "_Empty._",
    OVERSIZED_LINES: String(oversizedLines ?? 400),
  });
}

export function buildSplitterPrompt({ oversizedFiles, designMd, oversizedLines }) {
  return fillTemplate(loadPrompt("splitter"), {
    OVERSIZED_FILES: (oversizedFiles || []).map((f) => `- ${f}`).join("\n") || "_None._",
    DESIGN_MD: designMd || "_None._",
    OVERSIZED_LINES: String(oversizedLines ?? 400),
  });
}

export function buildReviewDiffPrompt({ diff }) {
  return fillTemplate(loadPrompt("review-diff"), {
    DIFF: truncate(diff, 12000) || "_Empty diff._",
  });
}

export function buildReviewCodebasePrompt({ treeListing, fileExcerpts }) {
  return fillTemplate(loadPrompt("review-codebase"), {
    TREE_LISTING: treeListing || "_Empty._",
    FILE_EXCERPTS: fileExcerpts || "_None._",
  });
}

export function buildReviewSpecPrompt({ designMd, specToc, contracts }) {
  return fillTemplate(loadPrompt("review-spec"), {
    DESIGN_MD: designMd || "_None._",
    SPEC_TOC: specToc || "_None._",
    CONTRACTS: contracts || "_None._",
  });
}
