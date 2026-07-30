/**
 * Pure stop / streak policy for swarm planner loop.
 * Parse failures must not share the unproductive (idle) counter.
 */

export const PRODUCTIVE_ACTION_TYPES = [
  "add_task",
  "split_task",
  "requeue_task",
  "add_plan_node",
  "waive_section",
];

export function isProductiveActionType(type) {
  return PRODUCTIVE_ACTION_TYPES.includes(type);
}

export function actionsAreProductive(actions, treeDone = false) {
  if (treeDone) return true;
  return (actions || []).some((a) => isProductiveActionType(a?.type));
}

/**
 * Productive only if a productive action type was present AND apply succeeded.
 * @param {Array<{ok?: boolean}>} results - parallel to actions from applyActions
 */
export function appliedActionsAreProductive(actions, results, treeDone = false) {
  if (treeDone) return true;
  const list = actions || [];
  const res = results || [];
  for (let i = 0; i < list.length; i += 1) {
    if (isProductiveActionType(list[i]?.type) && res[i]?.ok) return true;
  }
  return false;
}

/**
 * Advance streak counters after one planner invite settles.
 *
 * @param {object} state
 * @param {boolean} state.parseOk - planner returned a parsed plan (not null)
 * @param {boolean} state.productive - plan applied productive actions or tree.done
 * @param {boolean} state.stalled - running==0 && ready==0 && !done
 * @param {number} state.blockedCount - blocked leaves available to rescue
 * @param {number} state.blockedRescueWaves - rescue waves already used
 * @param {number} state.maxBlockedRescueWaves
 * @param {number} state.parseFailStreak
 * @param {number} state.unproductiveStreak
 */
export function nextStreaks(state) {
  const parseFailStreak = Number(state.parseFailStreak) || 0;
  const unproductiveStreak = Number(state.unproductiveStreak) || 0;
  const blockedRescueWaves = Number(state.blockedRescueWaves) || 0;
  const maxBlockedRescueWaves = Number(state.maxBlockedRescueWaves) || 0;
  const blockedCount = Number(state.blockedCount) || 0;

  if (!state.parseOk) {
    return {
      parseFailStreak: parseFailStreak + 1,
      unproductiveStreak,
      blockedRescueWaves,
      didRescue: false,
    };
  }

  if (!state.stalled || state.productive) {
    // Progress clears rescue budget so later stalls can self-heal again.
    return {
      parseFailStreak: 0,
      unproductiveStreak: 0,
      blockedRescueWaves: 0,
      didRescue: false,
    };
  }

  // stalled && !productive
  if (blockedCount > 0 && blockedRescueWaves < maxBlockedRescueWaves) {
    return {
      parseFailStreak: 0,
      unproductiveStreak: 0,
      blockedRescueWaves: blockedRescueWaves + 1,
      didRescue: true,
    };
  }

  return {
    parseFailStreak: 0,
    unproductiveStreak: unproductiveStreak + 1,
    blockedRescueWaves,
    didRescue: false,
  };
}

/**
 * @returns {{ stop: boolean, reason: null | 'planner_parse_exhausted' | 'idle_tree' }}
 */
export function shouldStop(state) {
  const parseFailStreak = Number(state.parseFailStreak) || 0;
  const unproductiveStreak = Number(state.unproductiveStreak) || 0;
  const maxPlannerParseFails = Number(state.maxPlannerParseFails) || 5;
  const maxUnproductivePlannerRounds = Number(state.maxUnproductivePlannerRounds) || 3;

  if (parseFailStreak >= maxPlannerParseFails) {
    return { stop: true, reason: "planner_parse_exhausted" };
  }
  if (unproductiveStreak >= maxUnproductivePlannerRounds) {
    return { stop: true, reason: "idle_tree" };
  }
  return { stop: false, reason: null };
}

export function stopConsoleMessage(reason) {
  if (reason === "planner_parse_exhausted") {
    return "[swarm] planner parse exhausted; stopping";
  }
  if (reason === "idle_tree") {
    return "[swarm] idle tree and no productive planner actions; stopping";
  }
  if (reason === "planner_done") {
    return "[swarm] planner declared done";
  }
  if (reason === "wall_budget") {
    return "[swarm] wall-clock budget exhausted";
  }
  if (reason === "token_budget") {
    return "[swarm] token budget exhausted";
  }
  return `[swarm] stopping (${reason || "unknown"})`;
}
