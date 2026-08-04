/**
 * Pure helpers for swarm-planner spawn failure detection (v13.7.1).
 * Distinguishes infra/agent spawn failure from malformed JSON output.
 */

/**
 * True when the planner agent did not produce usable text (ok=false or empty).
 * Empty/failed spawns must NOT be sent to json-repair (which would fabricate plans).
 * @param {{ ok?: boolean, output?: string } | null | undefined} result
 */
export function isSpawnFailure(result) {
  if (!result || typeof result !== "object") return true;
  if (!result.ok) return true;
  return !String(result.output || "").trim();
}
