import assert from "node:assert/strict";
import {
  nextPerfectObserveStreak,
  nextUnproductiveStreak,
  shouldStopSolo,
  soloStopConsoleMessage,
} from "./lib/solo-stop-policy.mjs";

function base(overrides = {}) {
  return {
    wallBudgetExhausted: false,
    tokenBudgetExhausted: false,
    turnIndex: 1,
    maxTurns: 200,
    agentStatus: "continue",
    healthOk: true,
    perfectObserveStreak: 0,
    observePerfectStreakToStop: 2,
    unproductiveStreak: 0,
    maxUnproductiveTurns: 3,
    treatBlockedAsStop: false,
    ...overrides,
  };
}

assert.equal(nextUnproductiveStreak(0, true), 0);
assert.equal(nextUnproductiveStreak(2, true), 0);
assert.equal(nextUnproductiveStreak(0, false), 1);
assert.equal(nextUnproductiveStreak(2, false), 3);

assert.equal(nextPerfectObserveStreak(0, { total: 10, passed: 10 }), 1);
assert.equal(nextPerfectObserveStreak(1, { total: 10, passed: 10 }), 2);
assert.equal(nextPerfectObserveStreak(2, { total: 10, passed: 9 }), 0);
assert.equal(nextPerfectObserveStreak(1, null), 0);

assert.deepEqual(shouldStopSolo(base()), { stop: false, reason: null });
assert.deepEqual(
  shouldStopSolo(base({ agentStatus: "done", healthOk: true })),
  { stop: true, reason: "agent_done" },
);
assert.deepEqual(
  shouldStopSolo(base({ agentStatus: "done", healthOk: false })),
  { stop: false, reason: null },
);
assert.deepEqual(
  shouldStopSolo(base({ perfectObserveStreak: 2 })),
  { stop: true, reason: "observe_perfect" },
);
assert.deepEqual(
  shouldStopSolo(base({ unproductiveStreak: 3 })),
  { stop: true, reason: "idle_agent" },
);
assert.deepEqual(
  shouldStopSolo(base({ turnIndex: 200, maxTurns: 200 })),
  { stop: true, reason: "max_turns" },
);
assert.deepEqual(
  shouldStopSolo(base({ wallBudgetExhausted: true })),
  { stop: true, reason: "wall_budget" },
);
assert.deepEqual(
  shouldStopSolo(base({ tokenBudgetExhausted: true })),
  { stop: true, reason: "token_budget" },
);
assert.deepEqual(
  shouldStopSolo(base({
    wallBudgetExhausted: true,
    agentStatus: "done",
    healthOk: true,
  })),
  { stop: true, reason: "wall_budget" },
);
assert.deepEqual(
  shouldStopSolo(base({ agentStatus: "blocked", treatBlockedAsStop: true })),
  { stop: true, reason: "agent_blocked" },
);
assert.deepEqual(
  shouldStopSolo(base({ agentStatus: "blocked" })),
  { stop: false, reason: null },
);

assert.match(soloStopConsoleMessage("agent_done"), /declared done/);
assert.match(soloStopConsoleMessage("idle_agent"), /idle/);

console.log("solo-stop-policy.test.mjs: ok");
