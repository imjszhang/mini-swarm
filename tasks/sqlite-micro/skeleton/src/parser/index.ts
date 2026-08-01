import type { Stmt } from "../ast.js";
import { tokenize } from "../tokenizer.js";
import { getStatementParser } from "./registry.js";

function splitStatements(tokens: ReturnType<typeof tokenize>): ReturnType<typeof tokenize>[] {
  const groups: ReturnType<typeof tokenize>[] = [];
  let current: ReturnType<typeof tokenize> = [];

  for (const token of tokens) {
    if (token.type === "punct" && token.value === ";") {
      groups.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

function firstKeyword(tokens: ReturnType<typeof tokenize>): string | undefined {
  for (const token of tokens) {
    if (token.type === "keyword") {
      return token.value;
    }
  }
  return undefined;
}

export function parseScript(sql: string): Stmt[] {
  const tokens = tokenize(sql);
  const groups = splitStatements(tokens);
  const stmts: Stmt[] = [];

  for (const group of groups) {
    if (group.length === 0) {
      continue;
    }

    const kw = firstKeyword(group);
    if (!kw) {
      throw new Error("parseScript: statement missing leading keyword");
    }

    const parser = getStatementParser(kw);
    if (!parser) {
      throw new Error(`no parser for ${kw}`);
    }

    const { stmt, next } = parser(group, 0);
    if (next !== group.length) {
      throw new Error(`parseScript: unparsed tokens after ${kw}`);
    }
    stmts.push(stmt);
  }

  return stmts;
}
