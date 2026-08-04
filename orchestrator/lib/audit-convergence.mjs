/**
 * Audit leaf convergence tracking for swarm stop / planner gating.
 * Persisted on tree.audit_state; pure helpers for tests.
 */

export function isAuditLeaf(node) {
  if (!node || typeof node !== "object") return false;
  const title = typeof node.title === "string" ? node.title : "";
  return /^\s*audit:/i.test(title);
}

function ensureAuditState(tree) {
  if (!tree.audit_state || typeof tree.audit_state !== "object") {
    tree.audit_state = {};
  }
  return tree.audit_state;
}

function sectionEntry(state, section) {
  if (!state[section] || typeof state[section] !== "object") {
    state[section] = { clean: 0 };
  }
  if (typeof state[section].clean !== "number") state[section].clean = 0;
  return state[section];
}

/**
 * Whether a changed-file path counts as code (vs guide / design notes).
 */
export function isCodePath(file) {
  const f = String(file || "").replace(/\\/g, "/");
  if (!f) return false;
  if (f === "DESIGN.md" || f.endsWith("/DESIGN.md")) return false;
  if (f === "GUIDE.md" || f.endsWith("/GUIDE.md")) return false;
  if (f.startsWith("guide/") || f.includes("/guide/")) return false;
  return true;
}

export function hasCodeChanges(files) {
  return (files || []).some((f) => isCodePath(f));
}

/**
 * Update per-section clean counters after a successful merge.
 * - Clean audit (no code change): +1 clean for each assigned section
 * - Dirty audit or any non-audit leaf with code changes: reset those sections to 0
 * - Non-audit leaf with no code change: no-op
 *
 * @param {object} tree
 * @param {object} task - leaf node (or { title, spec_sections })
 * @param {boolean} codeChanged
 */
export function updateAuditState(tree, task, codeChanged) {
  if (!tree || !task) return tree;
  const state = ensureAuditState(tree);
  const sections = Array.isArray(task.spec_sections) ? task.spec_sections.filter(Boolean) : [];
  if (!sections.length) return tree;

  const audit = isAuditLeaf(task);
  if (audit && !codeChanged) {
    for (const s of sections) {
      const e = sectionEntry(state, s);
      e.clean += 1;
    }
    return tree;
  }

  if (codeChanged) {
    for (const s of sections) {
      const e = sectionEntry(state, s);
      e.clean = 0;
    }
  }
  return tree;
}

/**
 * @param {object} tree
 * @param {object} cfg
 * @param {string[]} [allSections] - defaults to keys already in audit_state + uncovered scan helper
 * @returns {{
 *   bySection: Record<string, { clean: number, converged: boolean, rejectAudit: boolean }>,
 *   allConverged: boolean,
 *   rejectSections: string[],
 *   convergedSections: string[],
 * }}
 */
export function auditConvergence(tree, cfg = {}, allSections = null) {
  const threshold = Number(cfg.auditCleanConvergeThreshold ?? 1);
  const rejectAfter = Number(cfg.auditRejectAfterClean ?? 2);
  const waived = new Set(tree?.waived_sections || []);
  const state = tree?.audit_state && typeof tree.audit_state === "object" ? tree.audit_state : {};

  let sections = allSections;
  if (!Array.isArray(sections) || !sections.length) {
    sections = Object.keys(state);
  }

  const bySection = {};
  const rejectSections = [];
  const convergedSections = [];
  const active = [];

  for (const s of sections) {
    if (waived.has(s)) continue;
    active.push(s);
    const clean = Number(state[s]?.clean) || 0;
    const converged = threshold > 0 && clean >= threshold;
    const rejectAudit = rejectAfter > 0 && clean >= rejectAfter;
    bySection[s] = { clean, converged, rejectAudit };
    if (converged) convergedSections.push(s);
    if (rejectAudit) rejectSections.push(s);
  }

  const allConverged = threshold > 0
    && active.length > 0
    && active.every((s) => bySection[s].converged);

  return { bySection, allConverged, rejectSections, convergedSections };
}

/**
 * Audit leaves must declare files_scope (v13.7). Empty scope is a wildcard that
 * serializes the whole swarm; planner must name the implementation files.
 * @returns {string|null} error message, or null if ok / not an audit add_task
 */
export function auditScopeError(action) {
  if (!action || action.type !== "add_task") return null;
  if (!isAuditLeaf(action)) return null;
  const scope = Array.isArray(action.files_scope) ? action.files_scope.filter(Boolean) : [];
  if (scope.length) return null;
  return "audit leaf must declare files_scope (implementation files for its sections); empty scope is rejected";
}

/**
 * Whether an add_task action is an audit leaf that targets a reject section.
 * @returns {{ reject: boolean, section?: string, reason?: string }}
 */
export function shouldRejectAuditAction(action, rejectSections, { enforce = true } = {}) {
  if (!action || action.type !== "add_task") return { reject: false };
  if (!isAuditLeaf(action)) return { reject: false };
  const reject = new Set(rejectSections || []);
  if (!reject.size) return { reject: false };
  const sections = Array.isArray(action.spec_sections) ? action.spec_sections : [];
  for (const s of sections) {
    if (reject.has(s)) {
      return {
        reject: !!enforce,
        advisory: !enforce,
        section: s,
        reason: enforce
          ? `audit rejected: section ${s} already clean-audited; do not re-audit`
          : `audit advisory: section ${s} was already clean-audited, but quality gate is not met`,
      };
    }
  }
  return { reject: false };
}

/**
 * Format audit convergence lines for planner coverage block (no suite scores).
 */
export function formatAuditCoverage(tree, cfg, allSections) {
  const { bySection, allConverged, convergedSections } = auditConvergence(tree, cfg, allSections);
  const lines = [];
  const entries = Object.entries(bySection).sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) {
    lines.push("Audit convergence: no section clean counters yet.");
  } else {
    const parts = entries.map(([s, v]) => `${s}=${v.clean}${v.converged ? "*" : ""}`);
    lines.push(`Audit clean counts (* = converged): ${parts.join(", ")}`);
    if (convergedSections.length) {
      lines.push(`Converged sections (do not re-audit): ${convergedSections.join(", ")}`);
    }
  }
  if (allConverged) {
    lines.push("All sections clean-audited — declare done NOW.");
  }
  return lines.join("\n");
}
