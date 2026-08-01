import type { Stmt } from "../ast.js";
import type { Database } from "../engine/database.js";
import type { Row } from "../types.js";

export type StatementExecutor = (
  db: Database,
  stmt: Stmt,
) => Row[] | void;

const executors = new Map<string, StatementExecutor>();

export function registerExecutor(
  stmtType: string,
  fn: StatementExecutor,
): void {
  executors.set(stmtType, fn);
}

export function getExecutor(stmtType: string): StatementExecutor | undefined {
  return executors.get(stmtType);
}
