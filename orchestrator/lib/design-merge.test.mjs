#!/usr/bin/env node
import assert from "node:assert/strict";
import { mergeDesign } from "./design-merge.mjs";

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

run("ours unchanged → write theirs", () => {
  const r = mergeDesign({
    base: "# Design\n\nA\n",
    ours: "# Design\n\nA\n",
    theirs: "# Design\n\nB\n",
  });
  assert.equal(r.conflict, false);
  assert.equal(r.merged, "# Design\n\nB\n");
});

run("theirs unchanged → keep ours", () => {
  const r = mergeDesign({
    base: "# Design\n\nA\n",
    ours: "# Design\n\nA\nworker note\n",
    theirs: "# Design\n\nA\n",
  });
  assert.equal(r.conflict, false);
  assert.equal(r.merged, "# Design\n\nA\nworker note\n");
});

run("identical ours/theirs → keep", () => {
  const r = mergeDesign({
    base: "old\n",
    ours: "new\n",
    theirs: "new\n",
  });
  assert.equal(r.conflict, false);
  assert.equal(r.merged, "new\n");
});

run("non-overlapping edits merge cleanly", () => {
  const base = "# Design\n\n## Contracts\n\nold\n\n## Notes\n\nkeep\n";
  const ours = "# Design\n\n## Contracts\n\nworker-updated\n\n## Notes\n\nkeep\n";
  const theirs = "# Design\n\n## Contracts\n\nold\n\n## Notes\n\nplanner-note\n";
  const r = mergeDesign({ base, ours, theirs });
  assert.equal(r.conflict, false);
  assert.match(r.merged, /worker-updated/);
  assert.match(r.merged, /planner-note/);
});

run("overlapping edits → conflict, keep main", () => {
  const r = mergeDesign({
    base: "line\n",
    ours: "worker\n",
    theirs: "planner\n",
  });
  assert.equal(r.conflict, true);
  assert.equal(r.merged, null);
  assert.match(r.summary, /conflict/i);
});

if (process.exitCode) {
  console.error("FAIL");
  process.exit(1);
}
console.log("all design-merge tests passed");
