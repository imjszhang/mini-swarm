/**
 * Failure ledger: tracks per-item status, stuck counts, and adjudication verdicts.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export function ledgerPath(runDir) {
  return path.join(runDir, "ledger.json");
}

function atomicWrite(filePath, data) {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, filePath);
}

export function loadLedger(runDir) {
  const p = ledgerPath(runDir);
  if (!existsSync(p)) {
    return { items: {}, updated_at: null };
  }
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return { items: {}, updated_at: null };
  }
}

export function saveLedger(runDir, ledger) {
  const next = { ...ledger, updated_at: new Date().toISOString() };
  atomicWrite(ledgerPath(runDir), next);
  Object.assign(ledger, next);
  return ledger;
}

/**
 * Refresh statuses from a score report.
 * @param {object} ledger
 * @param {{ failures?: Array<{id:string, group?:string}>, total?: number }} report
 * @param {string} phaseLabel
 * @param {{ targetedIds?: string[] }} [opts] — if provided, stuck_count++ for targeted items still failing
 */
export function updateFromReport(ledger, report, phaseLabel, opts = {}) {
  ledger.items = ledger.items || {};
  const failingIds = new Set((report.failures || []).map((f) => f.id));
  const targeted = opts.targetedIds ? new Set(opts.targetedIds) : null;
  const at = new Date().toISOString();

  // Ensure entries for all currently failing items.
  for (const f of report.failures || []) {
    const id = f.id;
    if (!id) continue;
    const prev = ledger.items[id] || {
      group: f.group || null,
      status: "failing",
      attempts: [],
      stuck_count: 0,
      verdict: null,
    };
    prev.group = f.group || prev.group;
    prev.status = "failing";
    prev.attempts = prev.attempts || [];
    prev.attempts.push({ phase: phaseLabel, at });
    if (targeted && targeted.has(id)) {
      prev.stuck_count = (prev.stuck_count || 0) + 1;
    }
    ledger.items[id] = prev;
  }

  // Mark previously-known items that are no longer in failures as passing.
  for (const [id, item] of Object.entries(ledger.items)) {
    if (!failingIds.has(id) && item.status === "failing") {
      item.status = "passing";
      item.attempts = item.attempts || [];
      item.attempts.push({ phase: `${phaseLabel}:resolved`, at });
    }
  }

  return ledger;
}

export function itemsNeedingAdjudication(ledger, threshold = 2) {
  const out = [];
  for (const [id, item] of Object.entries(ledger.items || {})) {
    if (item.status !== "failing") continue;
    if (item.verdict) continue;
    if ((item.stuck_count || 0) >= threshold) {
      out.push({ id, ...item });
    }
  }
  return out;
}

export function applyVerdicts(ledger, verdicts) {
  const at = new Date().toISOString();
  for (const v of verdicts || []) {
    if (!v?.id || !ledger.items[v.id]) continue;
    ledger.items[v.id].verdict = {
      class: v.class,
      rationale: v.rationale || "",
      at,
    };
  }
  return ledger;
}

/** Items still in the repair queue (failing, not routed out by oracle/ambiguity). */
export function repairableFailingIds(ledger, report) {
  const out = [];
  for (const f of report.failures || []) {
    const item = ledger.items?.[f.id];
    const cls = item?.verdict?.class;
    if (cls === "suspected_oracle_bug" || cls === "spec_ambiguity") continue;
    out.push(f.id);
  }
  return out;
}

export function routedOutSummary(ledger) {
  const suspected = [];
  const ambiguities = [];
  const unowned = [];
  for (const [id, item] of Object.entries(ledger.items || {})) {
    const cls = item.verdict?.class;
    if (!cls) continue;
    const entry = { id, group: item.group, rationale: item.verdict.rationale };
    if (cls === "suspected_oracle_bug") suspected.push(entry);
    else if (cls === "spec_ambiguity") ambiguities.push(entry);
    else if (cls === "out_of_scope_dependency") unowned.push(entry);
  }
  return { suspected, ambiguities, unowned };
}
