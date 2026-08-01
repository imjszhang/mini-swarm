import type { Value } from "../types.js";

export type SqlFunction = {
  minArgs: number;
  maxArgs: number;
  impl: (...args: Value[]) => Value;
};

const functions = new Map<string, SqlFunction>();

export function registerFunction(name: string, fn: SqlFunction): void {
  functions.set(name.toLowerCase(), fn);
}

export function getFunction(name: string): SqlFunction | undefined {
  return functions.get(name.toLowerCase());
}
