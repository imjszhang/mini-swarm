import assert from "node:assert/strict";
import {
  applyAction,
  applyActions,
  createEmptyTree,
  formatTreeForPlanner,
  markLeaf,
} from "./tree.mjs";

function addLeaf(tree, id = "task-01") {
  const result = applyAction(tree, {
    type: "add_task",
    id,
    title: id,
  });
  assert.equal(result.ok, true);
  return tree.nodes[id];
}

{
  const tree = createEmptyTree();
  const leaf = addLeaf(tree);
  assert.equal(leaf.attempts, 0);
  assert.equal(leaf.total_attempts, 0);

  markLeaf(tree, leaf.id, "running");
  assert.equal(leaf.attempts, 1);
  assert.equal(leaf.total_attempts, 1);

  const requeue = applyAction(
    tree,
    { type: "requeue_task", id: leaf.id },
    { maxTotalLeafAttempts: 3 },
  );
  assert.equal(requeue.ok, true);
  assert.equal(leaf.attempts, 0);
  assert.equal(leaf.total_attempts, 1);

  markLeaf(tree, leaf.id, "running");
  assert.equal(leaf.attempts, 1);
  assert.equal(leaf.total_attempts, 2);

  markLeaf(tree, leaf.id, "done", null, {
    verified: { sha: "abc123", checked: 4 },
  });
  assert.deepEqual(leaf.verified, { sha: "abc123", checked: 4 });
  assert.match(formatTreeForPlanner(tree), /total_attempts=2/);
}

{
  const tree = createEmptyTree();
  const leaf = addLeaf(tree);
  leaf.status = "blocked";
  leaf.total_attempts = 3;

  const [result] = applyActions(
    tree,
    [{ type: "requeue_task", id: leaf.id }],
    { maxTotalLeafAttempts: 3 },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /split or retire/);
  assert.equal(leaf.status, "blocked");
  assert.equal(leaf.total_attempts, 3);
}

{
  const tree = createEmptyTree();
  const leaf = addLeaf(tree);
  leaf.status = "blocked";
  leaf.total_attempts = 99;

  const result = applyAction(tree, { type: "requeue_task", id: leaf.id });
  assert.equal(result.ok, true, "omitting maxTotalLeafAttempts remains backward-compatible");
  assert.equal(leaf.status, "pending");
  assert.equal(leaf.total_attempts, 99);
}

console.log("tree tests passed");
