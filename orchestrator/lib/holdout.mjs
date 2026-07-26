/**
 * Stratified, seeded holdout selection. Resume-safe: never regenerates if file exists.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

function holdoutPath(runDir) {
  return path.join(runDir, "holdout.json");
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seedToInt(seedStr) {
  const hex = createHash("sha1").update(String(seedStr)).digest("hex").slice(0, 8);
  return Number.parseInt(hex, 16) >>> 0;
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, filePath);
}

/**
 * @param {string} runDir
 * @param {string} examplesPath
 * @param {{ holdout?: { enabled?: boolean, ratio?: number, seed?: string } }} config
 * @returns {{ seed: string, ratio: number, ids: string[], enabled: boolean }}
 */
export function ensureHoldout(runDir, examplesPath, config) {
  const hoCfg = config.holdout || {};
  const enabled = hoCfg.enabled !== false;
  const p = holdoutPath(runDir);

  if (existsSync(p)) {
    try {
      const existing = JSON.parse(readFileSync(p, "utf8"));
      return {
        seed: existing.seed ?? String(hoCfg.seed ?? "v11"),
        ratio: existing.ratio ?? (hoCfg.ratio ?? 0.15),
        ids: Array.isArray(existing.ids) ? existing.ids : [],
        enabled,
      };
    } catch {
      /* regenerate below */
    }
  }

  if (!enabled) {
    const empty = { seed: String(hoCfg.seed ?? "v11"), ratio: 0, ids: [] };
    atomicWriteJson(p, empty);
    return { ...empty, enabled: false };
  }

  const examples = JSON.parse(readFileSync(examplesPath, "utf8"));
  const ratio = Number(hoCfg.ratio ?? 0.15);
  const seed = String(hoCfg.seed ?? "v11");

  const byGroup = new Map();
  for (const ex of examples) {
    const g = ex.section || ex.group || "default";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(ex.id);
  }

  const ids = [];
  for (const [group, groupIds] of byGroup.entries()) {
    if (groupIds.length < 4) continue;
    const rng = mulberry32(seedToInt(`${seed}:${group}`));
    const shuffled = shuffleInPlace([...groupIds], rng);
    const n = Math.ceil(ratio * shuffled.length);
    ids.push(...shuffled.slice(0, n));
  }
  ids.sort();

  const data = { seed, ratio, ids };
  atomicWriteJson(p, data);
  return { ...data, enabled };
}

export function holdoutFilePath(runDir) {
  return holdoutPath(runDir);
}
