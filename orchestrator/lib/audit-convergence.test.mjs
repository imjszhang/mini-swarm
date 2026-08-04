#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  auditConvergence,
  auditScopeError,
  formatAuditCoverage,
  hasCodeChanges,
  isAuditLeaf,
  isCodePath,
  shouldRejectAuditAction,
  updateAuditState,
} from "./audit-convergence.mjs";

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

run("isAuditLeaf detects audit: titles", () => {
  assert.equal(isAuditLeaf({ title: "audit: emphasis" }), true);
  assert.equal(isAuditLeaf({ title: "Audit: Links" }), true);
  assert.equal(isAuditLeaf({ title: "implement emphasis" }), false);
});

run("isCodePath / hasCodeChanges ignore guide and DESIGN", () => {
  assert.equal(isCodePath("src/foo.ts"), true);
  assert.equal(isCodePath("DESIGN.md"), false);
  assert.equal(isCodePath("guide/index.md"), false);
  assert.equal(hasCodeChanges(["DESIGN.md", "guide/index.md"]), false);
  assert.equal(hasCodeChanges(["DESIGN.md", "src/a.ts"]), true);
});

run("clean audit increments; dirty resets", () => {
  const tree = { audit_state: {}, waived_sections: [] };
  const task = { title: "audit: ATX", spec_sections: ["ATX headings"] };
  updateAuditState(tree, task, false);
  assert.equal(tree.audit_state["ATX headings"].clean, 1);
  updateAuditState(tree, task, false);
  assert.equal(tree.audit_state["ATX headings"].clean, 2);
  updateAuditState(tree, task, true);
  assert.equal(tree.audit_state["ATX headings"].clean, 0);
});

run("non-audit code change resets; no-op without code change", () => {
  const tree = { audit_state: { Paragraphs: { clean: 2 } }, waived_sections: [] };
  updateAuditState(tree, { title: "fix para", spec_sections: ["Paragraphs"] }, false);
  assert.equal(tree.audit_state.Paragraphs.clean, 2);
  updateAuditState(tree, { title: "fix para", spec_sections: ["Paragraphs"] }, true);
  assert.equal(tree.audit_state.Paragraphs.clean, 0);
});

run("auditConvergence allConverged and rejectSections", () => {
  const tree = {
    waived_sections: ["HTML blocks"],
    audit_state: {
      "ATX headings": { clean: 1 },
      Paragraphs: { clean: 2 },
      "HTML blocks": { clean: 0 },
    },
  };
  const sections = ["ATX headings", "Paragraphs", "HTML blocks"];
  const r = auditConvergence(tree, {
    auditCleanConvergeThreshold: 1,
    auditRejectAfterClean: 2,
  }, sections);
  assert.equal(r.allConverged, true);
  assert.deepEqual(r.convergedSections.sort(), ["ATX headings", "Paragraphs"]);
  assert.deepEqual(r.rejectSections, ["Paragraphs"]);
});

run("auditScopeError requires files_scope on audit leaves", () => {
  assert.equal(
    auditScopeError({ type: "add_task", title: "audit: x", files_scope: [] }),
    "audit leaf must declare files_scope (implementation files for its sections); empty scope is rejected",
  );
  assert.equal(
    auditScopeError({ type: "add_task", title: "audit: x" }),
    "audit leaf must declare files_scope (implementation files for its sections); empty scope is rejected",
  );
  assert.equal(
    auditScopeError({
      type: "add_task",
      title: "audit: x",
      files_scope: ["src/inline/emphasis.ts"],
    }),
    null,
  );
  assert.equal(
    auditScopeError({ type: "add_task", title: "implement x", files_scope: [] }),
    null,
  );
  assert.equal(auditScopeError({ type: "done" }), null);
});

run("shouldRejectAuditAction", () => {
  const ok = shouldRejectAuditAction(
    { type: "add_task", title: "audit: x", spec_sections: ["ATX headings"] },
    ["Paragraphs"],
  );
  assert.equal(ok.reject, false);
  const bad = shouldRejectAuditAction(
    { type: "add_task", title: "audit: x", spec_sections: ["Paragraphs"] },
    ["Paragraphs"],
  );
  assert.equal(bad.reject, true);
  assert.match(bad.reason, /already clean-audited/);
});

run("audit rejection can degrade to advisory", () => {
  const advisory = shouldRejectAuditAction(
    { type: "add_task", title: "audit: x", spec_sections: ["Paragraphs"] },
    ["Paragraphs"],
    { enforce: false },
  );
  assert.equal(advisory.reject, false);
  assert.equal(advisory.advisory, true);
  assert.match(advisory.reason, /quality gate is not met/);
});

run("formatAuditCoverage includes declare done NOW", () => {
  const tree = {
    waived_sections: [],
    audit_state: { A: { clean: 1 }, B: { clean: 1 } },
  };
  const text = formatAuditCoverage(tree, { auditCleanConvergeThreshold: 1 }, ["A", "B"]);
  assert.match(text, /declare done NOW/);
});

if (process.exitCode) {
  console.error("FAIL");
  process.exit(1);
}
console.log("all audit-convergence tests passed");
