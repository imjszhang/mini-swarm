import type { Stmt } from "../ast.js";
import type { Token } from "../tokenizer.js";

export type StatementParser = (
  tokens: Token[],
  start: number,
) => { stmt: Stmt; next: number };

const parsers = new Map<string, StatementParser>();

export function registerStatementParser(
  keyword: string,
  fn: StatementParser,
): void {
  parsers.set(keyword.toUpperCase(), fn);
}

export function getStatementParser(
  keyword: string,
): StatementParser | undefined {
  return parsers.get(keyword.toUpperCase());
}
