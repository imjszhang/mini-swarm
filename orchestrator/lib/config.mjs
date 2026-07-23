import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadConfig(overrides = {}) {
  const raw = JSON.parse(readFileSync(path.join(ROOT, "config.json"), "utf8"));
  return {
    ...raw,
    ...overrides,
    models: { ...raw.models, ...(overrides.models || {}) },
  };
}

export function projectRoot() {
  return ROOT;
}
