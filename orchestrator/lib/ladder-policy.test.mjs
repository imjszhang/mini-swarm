import assert from "node:assert/strict";
import { ladderDecision, shouldSkipL0 } from "./ladder-policy.mjs";

{
  const d = ladderDecision({
    metricsData: { stop_reason: "observe_perfect", visible_score: 0.5 },
    targetObserve: 0.9,
  });
  assert.equal(d.escalate, false);
  assert.equal(d.reason, "observe_perfect");
}

{
  const a = ladderDecision({ metricsData: { visible_score: 0.95 }, targetObserve: 0.9 });
  assert.equal(a.escalate, false);
  assert.equal(a.reason, "visible_above_target");
  const b = ladderDecision({ metricsData: { visible_score: 95 }, targetObserve: 0.9 });
  assert.equal(b.escalate, false);
  assert.equal(b.reason, "visible_above_target");
  const c = ladderDecision({
    metricsData: { visible_score: { rate: 0.95, passed: 95, total: 100 } },
    targetObserve: 0.9,
  });
  assert.equal(c.escalate, false);
  assert.equal(c.reason, "visible_above_target");
}

{
  const d = ladderDecision({ metricsData: { visible_score: 0.7 }, targetObserve: 0.9 });
  assert.equal(d.escalate, true);
  assert.equal(d.reason, "below_target");
  const e = ladderDecision({
    metricsData: { visible_score: { rate: 0.7 } },
    targetObserve: 0.9,
  });
  assert.equal(e.escalate, true);
  assert.equal(e.reason, "below_target");
}

{
  assert.equal(ladderDecision({ metricsData: null }).escalate, true);
  assert.equal(ladderDecision({ metricsData: null }).reason, "no_metrics");
  assert.equal(ladderDecision({ metricsData: {} }).reason, "no_metrics");
}

{
  assert.equal(shouldSkipL0({ specChars: 100000, specCharsSkipL0: null }), false);
  assert.equal(shouldSkipL0({ specChars: 100000, specCharsSkipL0: 50000 }), true);
  assert.equal(shouldSkipL0({ specChars: 1000, specCharsSkipL0: 50000 }), false);
}

console.log("ladder-policy tests passed");
