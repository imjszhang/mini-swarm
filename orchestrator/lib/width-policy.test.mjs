import assert from "node:assert/strict";
import {
  backpressureCap,
  frontierDemand,
  nextNarrowFrontierStreak,
  scopeDisjoint,
} from "./width-policy.mjs";

{
  assert.equal(frontierDemand([], []), 0);
  assert.equal(frontierDemand(null, null), 0);
}

{
  const running = [{ id: "a", files_scope: ["src/a.ts"] }];
  const ready = [
    { id: "b", files_scope: ["src/b.ts"] },
    { id: "c", files_scope: ["src/a.ts"] },
  ];
  assert.equal(frontierDemand(running, ready), 2);
}

{
  const ready = [
    { id: "a", files_scope: ["src/shared.ts"] },
    { id: "b", files_scope: ["src/shared.ts", "src/b.ts"] },
    { id: "c", files_scope: ["src/c.ts"] },
  ];
  assert.equal(frontierDemand([], ready), 2);
}

{
  const ready = [
    { id: "empty", files_scope: [] },
    { id: "missing" },
    { id: "a", files_scope: ["src/a.ts"] },
  ];
  assert.equal(frontierDemand([], ready), 3);
}

{
  assert.equal(
    backpressureCap({
      waitsMs: [1000, 2000],
      window: 5,
      mediumSec: 60,
      highSec: 180,
      maxConcurrency: 8,
    }),
    8,
    "insufficient samples keep maxConcurrency",
  );
}

{
  assert.equal(
    backpressureCap({
      waitsMs: [200_000, 200_000, 200_000, 200_000, 200_000],
      window: 5,
      mediumSec: 60,
      highSec: 180,
      maxConcurrency: 8,
    }),
    2,
  );
  assert.equal(
    backpressureCap({
      waitsMs: [90_000, 90_000, 90_000, 90_000, 90_000],
      window: 5,
      mediumSec: 60,
      highSec: 180,
      maxConcurrency: 8,
    }),
    4,
  );
  assert.equal(
    backpressureCap({
      waitsMs: [10_000, 10_000, 10_000, 10_000, 10_000],
      window: 5,
      mediumSec: 60,
      highSec: 180,
      maxConcurrency: 8,
    }),
    8,
  );
  assert.equal(
    backpressureCap({
      waitsMs: [200_000, 200_000, 200_000, 200_000, 200_000],
      window: 5,
      mediumSec: 60,
      highSec: 180,
      maxConcurrency: 2,
    }),
    2,
  );
}

{
  const running = [{ files_scope: ["src/a.ts"] }];
  assert.equal(scopeDisjoint({ files_scope: ["src/a.ts"] }, running), false);
  assert.equal(scopeDisjoint({ files_scope: ["src/b.ts"] }, running), true);
  assert.equal(scopeDisjoint({ files_scope: [] }, running), true);
  assert.equal(scopeDisjoint({}, running), true);
}

{
  assert.equal(nextNarrowFrontierStreak(0, { uncovered: 3, frontierSize: 1 }), 1);
  assert.equal(nextNarrowFrontierStreak(1, { uncovered: 3, frontierSize: 0 }), 2);
  assert.equal(nextNarrowFrontierStreak(2, { uncovered: 3, frontierSize: 2 }), 0);
  assert.equal(nextNarrowFrontierStreak(2, { uncovered: 0, frontierSize: 0 }), 0);
}

console.log("width-policy tests passed");
