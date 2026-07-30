#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  actionsAreProductive,
  appliedActionsAreProductive,
  nextStreaks,
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
