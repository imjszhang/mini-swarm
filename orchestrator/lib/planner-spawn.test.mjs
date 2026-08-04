import assert from "node:assert/strict";
import { isSpawnFailure } from "./planner-spawn.mjs";

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

run("isSpawnFailure: null/undefined", () => {
  assert.equal(isSpawnFailure(null), true);
  assert.equal(isSpawnFailure(undefined), true);
});

run("isSpawnFailure: ok=false", () => {
  assert.equal(isSpawnFailure({ ok: false, output: "" }), true);
  assert.equal(isSpawnFailure({ ok: false, output: "{}" }), true);
});

run("isSpawnFailure: empty output even if ok", () => {
  assert.equal(isSpawnFailure({ ok: true, output: "" }), true);
  assert.equal(isSpawnFailure({ ok: true, output: "   \n" }), true);
  assert.equal(isSpawnFailure({ ok: true }), true);
});

run("isSpawnFailure: non-empty output with ok", () => {
  assert.equal(isSpawnFailure({ ok: true, output: "{ broken" }), false);
  assert.equal(isSpawnFailure({ ok: true, output: '{"actions":[]}' }), false);
});

run("isSpawnFailure: missing/falsy ok is spawn failure", () => {
  assert.equal(isSpawnFailure({ output: "not json" }), true);
  assert.equal(isSpawnFailure({ ok: 0, output: "{}" }), true);
});
