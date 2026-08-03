#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  actionsAreProductive,
  appliedActionsAreProductive,
  doneGateDecision,
  nextPerfectObserveStreak,
  nextStreaks,
  observePlateau,
  shouldStop,
  stopConsoleMessage,
} from "./lib/swarm-stop-policy.mjs";

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

run("two parse fails do not idle-stop", () => {
  let s = { parseFailStreak: 0, unproductiveStreak: 0, blockedRescueWaves: 0 };
  s = { ...s, ...nextStreaks({ ...s, parseOk: false, productive: false, stalled: true, blockedCount: 0, maxBlockedRescueWaves: 2 }) };
  s = { ...s, ...nextStreaks({ ...s, parseOk: false, productive: false, stalled: true, blockedCount: 0, maxBlockedRescueWaves: 2 }) };
  assert.equal(s.parseFailStreak, 2);
  assert.equal(s.unproductiveStreak, 0);
  assert.equal(shouldStop({ ...s, maxPlannerParseFails: 5, maxUnproductivePlannerRounds: 3 }).stop, false);
});

run("parse success resets parseFailStreak", () => {
  const s = nextStreaks({
    parseOk: true,
    productive: true,
    stalled: false,
    blockedCount: 0,
    blockedRescueWaves: 0,
    maxBlockedRescueWaves: 2,
    parseFailStreak: 4,
    unproductiveStreak: 2,
  });
  assert.equal(s.parseFailStreak, 0);
  assert.equal(s.unproductiveStreak, 0);
});

run("successful parse + stalled + no blocked → unproductive++", () => {
  const s = nextStreaks({
    parseOk: true,
    productive: false,
    stalled: true,
    blockedCount: 0,
    blockedRescueWaves: 0,
    maxBlockedRescueWaves: 2,
    parseFailStreak: 0,
    unproductiveStreak: 0,
  });
  assert.equal(s.unproductiveStreak, 1);
  assert.equal(s.didRescue, false);
});

run("stalled with blocked → rescue, no idle++", () => {
  const s = nextStreaks({
    parseOk: true,
    productive: false,
    stalled: true,
    blockedCount: 3,
    blockedRescueWaves: 0,
    maxBlockedRescueWaves: 2,
    parseFailStreak: 0,
    unproductiveStreak: 1,
  });
  assert.equal(s.didRescue, true);
  assert.equal(s.blockedRescueWaves, 1);
  assert.equal(s.unproductiveStreak, 0);
  assert.equal(shouldStop({ ...s, maxPlannerParseFails: 5, maxUnproductivePlannerRounds: 3 }).stop, false);
});

run("rescue exhausted then idle-stop", () => {
  let s = {
    parseFailStreak: 0,
    unproductiveStreak: 0,
    blockedRescueWaves: 2,
  };
  // waves already at max → no rescue
  s = {
    ...s,
    ...nextStreaks({
      ...s,
      parseOk: true,
      productive: false,
      stalled: true,
      blockedCount: 2,
      maxBlockedRescueWaves: 2,
    }),
  };
  assert.equal(s.didRescue, false);
  assert.equal(s.unproductiveStreak, 1);
  s = {
    ...s,
    ...nextStreaks({
      ...s,
      parseOk: true,
      productive: false,
      stalled: true,
      blockedCount: 2,
      maxBlockedRescueWaves: 2,
    }),
  };
  s = {
    ...s,
    ...nextStreaks({
      ...s,
      parseOk: true,
      productive: false,
      stalled: true,
      blockedCount: 2,
      maxBlockedRescueWaves: 2,
    }),
  };
  assert.equal(s.unproductiveStreak, 3);
  const stop = shouldStop({ ...s, maxPlannerParseFails: 5, maxUnproductivePlannerRounds: 3 });
  assert.equal(stop.stop, true);
  assert.equal(stop.reason, "idle_tree");
});

run("parse streak hits max → planner_parse_exhausted", () => {
  const stop = shouldStop({
    parseFailStreak: 5,
    unproductiveStreak: 0,
    maxPlannerParseFails: 5,
    maxUnproductivePlannerRounds: 3,
  });
  assert.equal(stop.reason, "planner_parse_exhausted");
  assert.match(stopConsoleMessage(stop.reason), /parse exhausted/);
});

run("stopConsoleMessage token_budget", () => {
  assert.match(stopConsoleMessage("token_budget"), /token budget exhausted/);
  assert.match(stopConsoleMessage("wall_budget"), /wall-clock budget exhausted/);
});

run("nextPerfectObserveStreak increments on perfect", () => {
  assert.equal(nextPerfectObserveStreak(0, { total: 10, passed: 10 }), 1);
  assert.equal(nextPerfectObserveStreak(1, { total: 10, passed: 10 }), 2);
});

run("nextPerfectObserveStreak resets on imperfect or empty", () => {
  assert.equal(nextPerfectObserveStreak(3, { total: 10, passed: 9 }), 0);
  assert.equal(nextPerfectObserveStreak(2, { total: 0, passed: 0 }), 0);
  assert.equal(nextPerfectObserveStreak(1, null), 0);
});

run("stopConsoleMessage observe_perfect and audit_converged", () => {
  assert.match(stopConsoleMessage("observe_perfect"), /observe perfect streak/);
  assert.match(stopConsoleMessage("observe_plateau"), /quality plateau/);
  assert.match(stopConsoleMessage("audit_converged"), /audit converged/);
});

run("done gate accepts, defers stale, and rejects below gate", () => {
  assert.equal(doneGateDecision({
    minObserveRateForDone: 0.9,
    lastObserve: { rate: 0.91, atMergeCount: 3 },
    mergeCount: 3,
  }), "accept");
  assert.equal(doneGateDecision({
    minObserveRateForDone: 0.9,
    lastObserve: { rate: 0.95, atMergeCount: 2 },
    mergeCount: 3,
  }), "defer_stale");
  assert.equal(doneGateDecision({
    minObserveRateForDone: 0.9,
    lastObserve: { rate: null, atMergeCount: 3 },
    mergeCount: 3,
  }), "defer_stale");
  assert.equal(doneGateDecision({
    minObserveRateForDone: 0.9,
    lastObserve: { rate: 0.89, atMergeCount: 3 },
    mergeCount: 3,
  }), "reject_below_gate");
  assert.equal(doneGateDecision({
    minObserveRateForDone: null,
    lastObserve: null,
    mergeCount: 3,
  }), "accept");
  assert.equal(doneGateDecision({ mock: true }), "accept");
});

run("observe plateau requires a full low-gain window", () => {
  assert.equal(observePlateau([{ rate: 0.8 }, { rate: 0.81 }], 4, 0.5), false);
  assert.equal(observePlateau([
    { rate: null }, { rate: null }, { rate: null }, { rate: null },
  ], 4, 0.5), false);
  assert.equal(observePlateau([
    { rate: 0.9 }, { rate: 0.902 }, { rate: 0.903 }, { rate: 0.904 },
  ], 4, 0.5), true);
  assert.equal(observePlateau([
    { rate: 0.9 }, { rate: 0.902 }, { rate: 0.904 }, { rate: 0.906 },
  ], 4, 0.5), false);
});

run("actionsAreProductive recognizes productive types", () => {
  assert.equal(actionsAreProductive([{ type: "retire_task" }]), false);
  assert.equal(actionsAreProductive([{ type: "add_task" }]), true);
  assert.equal(actionsAreProductive([], true), true);
});

run("appliedActionsAreProductive requires apply ok", () => {
  const actions = [{ type: "add_task" }, { type: "retire_task" }];
  assert.equal(appliedActionsAreProductive(actions, [{ ok: false }, { ok: true }]), false);
  assert.equal(appliedActionsAreProductive(actions, [{ ok: true }, { ok: true }]), true);
});

run("progress resets blockedRescueWaves", () => {
  const s = nextStreaks({
    parseOk: true,
    productive: true,
    stalled: false,
    blockedCount: 0,
    blockedRescueWaves: 2,
    maxBlockedRescueWaves: 2,
    parseFailStreak: 0,
    unproductiveStreak: 1,
  });
  assert.equal(s.blockedRescueWaves, 0);
});

if (process.exitCode) {
  console.error("FAIL");
  process.exit(1);
}
console.log("all stop-policy tests passed");
