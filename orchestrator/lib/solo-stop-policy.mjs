/**
 * Pure stop / streak policy for solo (single-agent) turn loop.
 * Reuses observe-perfect streak helper from swarm-stop-policy.
 */
import { nextPerfectObserveStreak } from "./swarm-stop-policy.mjs";

export { nextPerfectObserveStreak };

/**
 * Advance unproductive (no-diff) streak after a turn.
 * Productive turns reset the streak to 0.
 *
 * @param {number} streak
 * @param {boolean} hadDiff
 */
export function nextUnproductiveStreak(streak, hadDiff) {
  const prev = Number(streak) || 0;
  if (hadDiff) return 0;
  return prev + 1;
}

/**
 * Decide whether the solo loop should stop after a settled turn.
 *
 * Priority (first match wins):
 * 1. wall_budget / token_budget (caller sets flags)
 * 2. max_turns
 * 3. agent_done (report status=done AND healthOk)
 * 4. observe_perfect
 * 5. idle_agent (unproductive streak)
 * 6. agent_blocked (optional soft stop — only when treatBlockedAsStop)
 *
 * @returns {{ stop: boolean, reason: string|null }}
 */
export function shouldStopSolo(state) {
  if (state.wallBudgetExhausted) {
    return { stop: true, reason: "wall_budget" };
  }
  if (state.tokenBudgetExhausted) {
    return { stop: true, reason: "token_budget" };
  }

  const turnIndex = Number(state.turnIndex) || 0;
  const maxTurns = Number(state.maxTurns) || 0;
  if (maxTurns > 0 && turnIndex >= maxTurns) {
    return { stop: true, reason: "max_turns" };
  }

  const status = String(state.agentStatus || "").toLowerCase();
  const minTurns = Number(state.minTurnsBeforeAgentDone) || 0;
  const minObserve = state.minObserveRateForAgentDone;
  const observeRate = state.observeRate;
  const agentDoneEligible = status === "done" && state.healthOk
    && (minTurns <= 0 || turnIndex >= minTurns)
    && (minObserve == null || observeRate == null || observeRate >= minObserve);

  if (agentDoneEligible) {
    return { stop: true, reason: "agent_done" };
  }

  const perfectStreak = Number(state.perfectObserveStreak) || 0;
  const needPerfect = Number(state.observePerfectStreakToStop) || 0;
  if (needPerfect > 0 && perfectStreak >= needPerfect) {
    return { stop: true, reason: "observe_perfect" };
  }

  const unproductive = Number(state.unproductiveStreak) || 0;
  const maxUnproductive = Number(state.maxUnproductiveTurns) || 0;
  if (maxUnproductive > 0 && unproductive >= maxUnproductive) {
    return { stop: true, reason: "idle_agent" };
  }

  if (state.treatBlockedAsStop && status === "blocked") {
    return { stop: true, reason: "agent_blocked" };
  }

  return { stop: false, reason: null };
}

export function soloStopConsoleMessage(reason) {
  if (reason === "agent_done") return "[solo] agent declared done; stopping";
  if (reason === "agent_done_deferred") return "[solo] agent declared done but observe below threshold; continuing";
  if (reason === "observe_perfect") return "[solo] observe perfect streak reached; stopping";
  if (reason === "wall_budget") return "[solo] wall-clock budget exhausted";
  if (reason === "token_budget") return "[solo] token budget exhausted";
  if (reason === "idle_agent") return "[solo] idle agent (no file changes); stopping";
  if (reason === "max_turns") return "[solo] max turns reached; stopping";
  if (reason === "agent_blocked") return "[solo] agent blocked; stopping";
  return `[solo] stopping (${reason || "unknown"})`;
}
