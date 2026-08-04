/**
 * Pure width / backpressure policy for demand-driven swarm concurrency.
 * Scores never enter agent prompts; harness-side only.
 *
 * Empty/missing files_scope is a wildcard: it conflicts with every other leaf
 * (v13.7 — previously treated as independent, which let audit leaves race).
 */

function scopeFiles(leaf) {
  const scope = leaf?.files_scope;
  if (!Array.isArray(scope) || !scope.length) return [];
  return scope.map((f) => String(f)).filter(Boolean);
}

function isWildcard(leaf) {
  return scopeFiles(leaf).length === 0;
}

function scopesIntersect(a, b) {
  if (!a.length || !b.length) return false;
  const setB = new Set(b);
  return a.some((f) => setB.has(f));
}

/**
 * Greedy disjoint-scope count over the active frontier.
 * 输入均为 leaf 节点数组（含 files_scope: string[]）。
 * 顺序：先 runningLeaves（原顺序），后 readyLeaves（原顺序）。
 * 规则：一个 leaf 计入当且仅当其 files_scope 与「已计入 leaf 的 scope 并集」无交集；
 * files_scope 为空/缺失视为通配——仅在尚未计入任何 leaf 时独占计入，之后挡住一切。
 * @returns {number} demand
 */
export function frontierDemand(runningLeaves, readyLeaves) {
  const taken = new Set();
  let wildcardTaken = false;
  let demand = 0;
  const sequence = [...(runningLeaves || []), ...(readyLeaves || [])];
  for (const leaf of sequence) {
    if (!leaf) continue;
    const files = scopeFiles(leaf);
    if (!files.length) {
      // Wildcard: only counts if nothing else is already counted.
      if (demand > 0 || wildcardTaken) continue;
      demand += 1;
      wildcardTaken = true;
      continue;
    }
    if (wildcardTaken) continue;
    if (files.some((f) => taken.has(f))) continue;
    demand += 1;
    for (const f of files) taken.add(f);
  }
  return demand;
}

/**
 * merge 背压封顶。waitsMs 为调用方已截取的最近 window 条 merge 等待毫秒数组。
 * 样本数 < window → 返回 maxConcurrency（数据不足不降级）。
 * avg > highSec*1000 → 返回 min(2, maxConcurrency)；
 * avg > mediumSec*1000 → 返回 min(4, maxConcurrency)；否则 maxConcurrency。
 */
export function backpressureCap({
  waitsMs,
  window,
  mediumSec,
  highSec,
  maxConcurrency,
} = {}) {
  const maxConc = Math.max(1, Number(maxConcurrency) || 1);
  const win = Math.floor(Number(window) || 0);
  const samples = Array.isArray(waitsMs) ? waitsMs.map((w) => Number(w) || 0) : [];
  if (win <= 0 || samples.length < win) return maxConc;

  const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
  const highMs = (Number(highSec) || 0) * 1000;
  const mediumMs = (Number(mediumSec) || 0) * 1000;
  if (avg > highMs) return Math.min(2, maxConc);
  if (avg > mediumMs) return Math.min(4, maxConc);
  return maxConc;
}

/**
 * candidate 可否与当前 runningLeaves 并行。
 * 通配（空 scope）candidate 仅当 running 为空时 true；
 * 任一 running 为通配时，所有 candidate 为 false。
 */
export function scopeDisjoint(candidate, runningLeaves) {
  const running = runningLeaves || [];
  if (running.some((leaf) => isWildcard(leaf))) return false;
  if (isWildcard(candidate)) return running.length === 0;
  const candFiles = scopeFiles(candidate);
  for (const leaf of running) {
    const runFiles = scopeFiles(leaf);
    if (scopesIntersect(candFiles, runFiles)) return false;
  }
  return true;
}

/**
 * 窄前沿建议计数器：uncovered>0 且 frontierSize<2 → prev+1，否则 0。
 * 调用方在达到阈值并发出 advisory 后自行清零。
 */
export function nextNarrowFrontierStreak(prev, { uncovered, frontierSize } = {}) {
  const prevN = Number(prev) || 0;
  const unc = Number(uncovered) || 0;
  const frontier = Number(frontierSize) || 0;
  if (unc > 0 && frontier < 2) return prevN + 1;
  return 0;
}
