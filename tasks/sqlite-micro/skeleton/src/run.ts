import { parseScript } from "./parser/index.js";

export function runScript(input: string): string {
  const trimmed = input.replace(/^\uFEFF/, "");
  if (!trimmed.trim()) return "[]";
  const m = trimmed.match(/^\s*SELECT\s+(-?\d+)\s*;?\s*$/i);
  if (m) return JSON.stringify([[Number(m[1])]]);
  parseScript(trimmed);
  throw new Error("runScript: not implemented");
}
