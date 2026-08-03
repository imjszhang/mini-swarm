/**
 * Swarm task tree: plan nodes + leaf tasks with deps.
 * Persisted as runs/{id}/tree.json.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

function atomicWrite(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, filePath);
}

export function treePath(runDir) {
  return path.join(runDir, "tree.json");
}

export function createEmptyTree() {
  return {
    version: 1,
    next_id: 1,
    nodes: {},
    done: false,
    planner_rounds: 0,
    waived_sections: [],
  };
}

export function loadTree(runDir) {
  const p = treePath(runDir);
  if (!existsSync(p)) return createEmptyTree();
  return JSON.parse(readFileSync(p, "utf8"));
}

export function saveTree(runDir, tree) {
  atomicWrite(treePath(runDir), tree);
}

function allocId(tree, prefix) {
  const id = `${prefix}-${String(tree.next_id).padStart(2, "0")}`;
  tree.next_id += 1;
  return id;
}

function depthOf(tree, nodeId, seen = new Set()) {
  if (!nodeId || seen.has(nodeId)) return 0;
  seen.add(nodeId);
  const n = tree.nodes[nodeId];
  if (!n?.parent) return 0;
  return 1 + depthOf(tree, n.parent, seen);
}

function normalizeTitle(title) {
  return String(title || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveRemappedId(id, idRemap) {
  if (!id || !idRemap) return id;
  let cur = id;
  const seen = new Set();
  while (idRemap.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    cur = idRemap.get(cur);
  }
  return cur;
}

/** Translate deps/parent/from through a batch-local id remap table. */
function remapActionRefs(action, idRemap) {
  if (!action || typeof action !== "object" || !idRemap?.size) return action;
  const a = { ...action };
  if (a.parent) a.parent = resolveRemappedId(a.parent, idRemap);
  if (a.from) a.from = resolveRemappedId(a.from, idRemap);
  if (Array.isArray(a.deps)) {
    a.deps = a.deps.map((d) => resolveRemappedId(d, idRemap));
  }
  if (Array.isArray(a.children)) {
    a.children = a.children.map((c) => remapActionRefs(c, idRemap));
  }
  return a;
}

/**
 * Apply a single planner action. Returns { ok, error?, id?, remapped?, idempotent? }.
 * When `idRemap` (Map) is provided, duplicate IDs are remapped or treated as idempotent.
 */
export function applyAction(
  tree,
  action,
  { maxTreeDepth = 2, maxTotalLeafAttempts = Infinity, idRemap = null } = {},
) {
  if (!action || typeof action !== "object") return { ok: false, error: "invalid action" };
  const a = remapActionRefs(action, idRemap);
  const type = a.type;

  if (type === "done") {
    tree.done = true;
    return { ok: true };
  }

  if (type === "update_design") {
    // DESIGN.md content is written by the caller; action only acknowledges.
    return { ok: true, design: a.content || a.design || "" };
  }

  if (type === "add_plan_node") {
    let id = a.id || allocId(tree, "plan");
    const requestedId = a.id || null;
    if (tree.nodes[id]) {
      const existing = tree.nodes[id];
      const same =
        existing.kind === "plan"
        && normalizeTitle(existing.title) === normalizeTitle(a.title || id);
      if (same) return { ok: true, id, idempotent: true };
      const newId = allocId(tree, "plan");
      if (requestedId && idRemap) idRemap.set(requestedId, newId);
      id = newId;
    }
    const parent = a.parent || null;
    const depth = parent ? depthOf(tree, parent) + 1 : 0;
    if (depth > maxTreeDepth) return { ok: false, error: `maxTreeDepth ${maxTreeDepth} exceeded` };
    tree.nodes[id] = {
      id,
      kind: "plan",
      title: a.title || id,
      parent,
      deps: a.deps || [],
      status: "open",
      notes: a.notes || "",
    };
    return {
      ok: true,
      id,
      remapped: !!(requestedId && requestedId !== id),
      from: requestedId && requestedId !== id ? requestedId : undefined,
    };
  }

  if (type === "add_task") {
    let id = a.id || allocId(tree, "task");
    const requestedId = a.id || null;
    if (tree.nodes[id]) {
      const existing = tree.nodes[id];
      const same =
        existing.kind === "leaf"
        && normalizeTitle(existing.title) === normalizeTitle(a.title || id);
      if (same) return { ok: true, id, idempotent: true };
      const newId = allocId(tree, "task");
      if (requestedId && idRemap) idRemap.set(requestedId, newId);
      id = newId;
    }
    const parent = a.parent || null;
    const depth = parent ? depthOf(tree, parent) + 1 : 0;
    if (depth > maxTreeDepth) return { ok: false, error: `maxTreeDepth ${maxTreeDepth} exceeded` };
    tree.nodes[id] = {
      id,
      kind: "leaf",
      title: a.title || id,
      parent,
      deps: a.deps || [],
      status: "pending",
      files_scope: a.files_scope || [],
      spec_sections: a.spec_sections || [],
      notes: a.notes || "",
      report: null,
      attempts: 0,
      total_attempts: 0,
    };
    return {
      ok: true,
      id,
      remapped: !!(requestedId && requestedId !== id),
      from: requestedId && requestedId !== id ? requestedId : undefined,
    };
  }

  if (type === "split_task") {
    const from = a.from || a.id;
    const node = tree.nodes[from];
    if (!node || node.kind !== "leaf") return { ok: false, error: `split_task: missing leaf ${from}` };
    node.status = "retired";
    const children = a.children || [];
    const ids = [];
    for (const child of children) {
      const r = applyAction(tree, {
        type: "add_task",
        ...child,
        parent: node.parent || from,
        deps: child.deps || node.deps,
      }, { maxTreeDepth, maxTotalLeafAttempts, idRemap });
      if (!r.ok) return r;
      ids.push(r.id);
    }
    return { ok: true, id: from, children: ids };
  }

  if (type === "retire_task") {
    const id = a.id;
    const node = tree.nodes[id];
    if (!node) return { ok: false, error: `retire_task: missing ${id}` };
    node.status = "retired";
    return { ok: true, id };
  }

  if (type === "requeue_task") {
    const id = a.id;
    const node = tree.nodes[id];
    if (!node || node.kind !== "leaf") return { ok: false, error: `requeue_task: missing leaf ${id}` };
    const totalAttempts = Number(node.total_attempts) || 0;
    const maxTotal = Number(maxTotalLeafAttempts);
    if (Number.isFinite(maxTotal) && totalAttempts >= maxTotal) {
      return {
        ok: false,
        error: `requeue_task: ${id} reached maxTotalLeafAttempts ${maxTotal}; split or retire this leaf`,
      };
    }
    node.status = "pending";
    node.report = null;
    node.attempts = 0;
    delete node.verified;
    return { ok: true, id };
  }

  if (type === "waive_section") {
    const section = typeof a.section === "string" ? a.section.trim() : "";
    if (!section) return { ok: false, error: "waive_section: empty section" };
    if (!Array.isArray(tree.waived_sections)) tree.waived_sections = [];
    if (!tree.waived_sections.includes(section)) {
      tree.waived_sections.push(section);
    }
    return { ok: true, section, reason: a.reason || "" };
  }

  return { ok: false, error: `unknown action type: ${type}` };
}

export function applyActions(tree, actions, opts = {}) {
  const idRemap = opts.idRemap || new Map();
  const results = [];
  for (const action of actions || []) {
    results.push(applyAction(tree, action, { ...opts, idRemap }));
  }
  return results;
}

function depsSatisfied(tree, node) {
  for (const d of node.deps || []) {
    const dep = tree.nodes[d];
    if (!dep) continue;
    if (dep.kind === "leaf" && dep.status !== "done") return false;
    if (dep.kind === "plan" && dep.status !== "done") return false;
  }
  return true;
}

/** Ready leaves: pending, deps met, not retired. */
export function readyLeaves(tree) {
  return Object.values(tree.nodes).filter(
    (n) => n.kind === "leaf" && n.status === "pending" && depsSatisfied(tree, n),
  );
}

export function markLeaf(tree, id, status, report = null, { verified = null } = {}) {
  const n = tree.nodes[id];
  if (!n || n.kind !== "leaf") return false;
  n.status = status;
  if (report != null) n.report = report;
  if (status === "running") {
    n.attempts = (n.attempts || 0) + 1;
    n.total_attempts = (n.total_attempts || 0) + 1;
    delete n.verified;
  }
  if (status === "done" && verified != null) n.verified = verified;
  return true;
}

export function treeStats(tree) {
  const nodes = Object.values(tree.nodes || {});
  const leaves = nodes.filter((n) => n.kind === "leaf");
  return {
    total_nodes: nodes.length,
    plan_nodes: nodes.filter((n) => n.kind === "plan").length,
    leaves: leaves.length,
    pending: leaves.filter((n) => n.status === "pending").length,
    running: leaves.filter((n) => n.status === "running").length,
    done: leaves.filter((n) => n.status === "done").length,
    blocked: leaves.filter((n) => n.status === "blocked").length,
    failed: leaves.filter((n) => n.status === "failed").length,
    retired: leaves.filter((n) => n.status === "retired").length,
    planner_rounds: tree.planner_rounds || 0,
    done_flag: !!tree.done,
  };
}

/** Compact tree summary for planner prompts (no test scores). */
export function formatTreeForPlanner(tree) {
  const lines = ["# Task tree", ""];
  let retiredHidden = 0;
  const doneLeaves = [];
  for (const n of Object.values(tree.nodes)) {
    if (n.kind === "plan") {
      lines.push(`- PLAN ${n.id}: ${n.title} [${n.status}] parent=${n.parent || "-"}`);
      continue;
    }
    if (n.status === "retired") {
      retiredHidden += 1;
      continue;
    }
    if (n.status === "done") {
      doneLeaves.push(n);
      continue;
    }
    lines.push(
      `- LEAF ${n.id}: ${n.title} [${n.status}] scope=${JSON.stringify(n.files_scope || [])}`
        + ` sections=${JSON.stringify(n.spec_sections || [])}`
        + ` attempts=${n.attempts || 0}`
        + ` total_attempts=${n.total_attempts || 0}`,
    );
    if (n.report?.summary) lines.push(`  report: ${String(n.report.summary).slice(0, 160)}`);
    if (n.report?.oversized_files?.length) {
      lines.push(`  oversized: ${n.report.oversized_files.join(", ")}`);
    }
  }
  if (doneLeaves.length) {
    const doneSummary = doneLeaves.map((n) => `${n.id}(total_attempts=${n.total_attempts || 0})`);
    lines.push(`Done leaves (${doneLeaves.length}): ${doneSummary.join(", ")}`);
  }
  if (retiredHidden > 0) lines.push(`(+${retiredHidden} retired leaves hidden)`);
  if (!Object.keys(tree.nodes).length) lines.push("_Empty — please create the initial decomposition._");
  const allIds = Object.keys(tree.nodes || {}).sort();
  if (allIds.length) {
    lines.push("");
    lines.push(`All existing IDs (never reuse, incl. retired): ${allIds.join(", ")}`);
  }
  return lines.join("\n");
}

