/**
 * Pure solo→swarm ladder escalation decisions (harness-side only).
 */

/**
 * Normalize visible score from metrics.
 * Accepts: report object `{ rate }`, bare number 0..1, or percent 0..100.
 */
function normalizeVisibleRate(visibleScore) {
  if (visibleScore == null) return Number.NaN;
  if (typeof visibleScore === "object") {
    const rate = Number(visibleScore.rate);
    return Number.isFinite(rate) ? rate : Number.NaN;
  }
  const num = Number(visibleScore);
  if (!Number.isFinite(num)) return Number.NaN;
  return num > 1 ? num / 100 : num;
}

/**
 * 读 solo 最终 metrics 决定是否升级。
 * visible_score 可能是 `{ rate }`、0..1 数字或 0..100 百分数。
 * @returns {{ escalate: boolean, reason: string }}
 */
export function ladderDecision({ metricsData, targetObserve = 0.9 } = {}) {
  if (!metricsData || typeof metricsData !== "object") {
    return { escalate: true, reason: "no_metrics" };
  }
  if (metricsData.stop_reason === "observe_perfect") {
    return { escalate: false, reason: "observe_perfect" };
  }
  const v = normalizeVisibleRate(metricsData.visible_score);
  if (!Number.isFinite(v)) {
    return { escalate: true, reason: "no_metrics" };
  }
  const target = Number(targetObserve);
  if (Number.isFinite(target) && v >= target) {
    return { escalate: false, reason: "visible_above_target" };
  }
  return { escalate: true, reason: "below_target" };
}

/** specCharsSkipL0 为 null → false；specChars > specCharsSkipL0 → true。 */
export function shouldSkipL0({ specChars, specCharsSkipL0 } = {}) {
  if (specCharsSkipL0 == null) return false;
  const threshold = Number(specCharsSkipL0);
  const chars = Number(specChars);
  if (!Number.isFinite(threshold) || !Number.isFinite(chars)) return false;
  return chars > threshold;
}
