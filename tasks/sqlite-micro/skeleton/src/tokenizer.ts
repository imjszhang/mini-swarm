/**
 * Keywords are recognized case-insensitively and stored with UPPERCASE `value`.
 * Identifiers keep their original spelling from the source.
 */
export type Token = {
  type: "keyword" | "identifier" | "string" | "number" | "operator" | "punct";
  value: string;
};

const KEYWORDS = new Set([
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "CREATE",
  "TABLE",
  "FROM",
  "WHERE",
  "ORDER",
  "BY",
  "LIMIT",
  "OFFSET",
  "AS",
  "AND",
  "OR",
  "NOT",
  "NULL",
  "IS",
  "BETWEEN",
  "IN",
  "LIKE",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "CAST",
  "DISTINCT",
  "VALUES",
  "INTO",
  "SET",
  "ASC",
  "DESC",
  "ON",
]);

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function skipLineComment(sql: string, i: number): number {
  i += 2;
  while (i < sql.length && sql[i] !== "\n") i++;
  return i;
}

function skipBlockComment(sql: string, i: number): number {
  i += 2;
  while (i < sql.length) {
    if (sql[i] === "*" && sql[i + 1] === "/") return i + 2;
    i++;
  }
  return i;
}

function readString(sql: string, start: number): { value: string; next: number } {
  let i = start + 1;
  let value = "";
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      if (sql[i + 1] === "'") {
        value += "'";
        i += 2;
        continue;
      }
      return { value, next: i + 1 };
    }
    value += ch;
    i++;
  }
  return { value, next: i };
}

function readQuotedIdent(sql: string, start: number): { value: string; next: number } {
  let i = start + 1;
  let value = "";
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === '"') {
      if (sql[i + 1] === '"') {
        value += '"';
        i += 2;
        continue;
      }
      return { value, next: i + 1 };
    }
    value += ch;
    i++;
  }
  return { value, next: i };
}

function readNumber(sql: string, start: number): { value: string; next: number } {
  let i = start;
  if (sql[i] === "-" || sql[i] === "+") i++;
  while (i < sql.length && isDigit(sql[i])) i++;
  if (sql[i] === "." && isDigit(sql[i + 1] ?? "")) {
    i++;
    while (i < sql.length && isDigit(sql[i])) i++;
  }
  if (sql[i] === "e" || sql[i] === "E") {
    i++;
    if (sql[i] === "+" || sql[i] === "-") i++;
    while (i < sql.length && isDigit(sql[i])) i++;
  }
  return { value: sql.slice(start, i), next: i };
}

function readIdent(sql: string, start: number): { value: string; next: number } {
  let i = start;
  while (i < sql.length && isIdentPart(sql[i]!)) i++;
  return { value: sql.slice(start, i), next: i };
}

function tryOperator(sql: string, i: number): { token: Token; next: number } | null {
  const two = sql.slice(i, i + 2);
  const three = sql.slice(i, i + 3);
  if (two === "<=" || two === ">=" || two === "<>" || two === "!=" || two === "||") {
    return { token: { type: "operator", value: two }, next: i + 2 };
  }
  const one = sql[i]!;
  if ("=<>+-*/%".includes(one)) {
    return { token: { type: "operator", value: one }, next: i + 1 };
  }
  if ("(),.;".includes(one)) {
    return { token: { type: "punct", value: one }, next: i + 1 };
  }
  if (one === "," || one === ";") {
    return { token: { type: "punct", value: one }, next: i + 1 };
  }
  void three;
  return null;
}

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i]!;

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    if (ch === "-" && sql[i + 1] === "-") {
      i = skipLineComment(sql, i);
      continue;
    }

    if (ch === "/" && sql[i + 1] === "*") {
      i = skipBlockComment(sql, i);
      continue;
    }

    if (ch === "'") {
      const { value, next } = readString(sql, i);
      tokens.push({ type: "string", value });
      i = next;
      continue;
    }

    if (ch === '"') {
      const { value, next } = readQuotedIdent(sql, i);
      tokens.push({ type: "identifier", value });
      i = next;
      continue;
    }

    const op = tryOperator(sql, i);
    if (op) {
      tokens.push(op.token);
      i = op.next;
      continue;
    }

    if (isDigit(ch) || ((ch === "+" || ch === "-") && isDigit(sql[i + 1] ?? ""))) {
      const { value, next } = readNumber(sql, i);
      tokens.push({ type: "number", value });
      i = next;
      continue;
    }

    if (isIdentStart(ch)) {
      const { value, next } = readIdent(sql, i);
      const upper = value.toUpperCase();
      if (KEYWORDS.has(upper)) {
        tokens.push({ type: "keyword", value: upper });
      } else {
        tokens.push({ type: "identifier", value });
      }
      i = next;
      continue;
    }

    throw new Error(`unexpected character at ${i}: ${JSON.stringify(ch)}`);
  }

  return tokens;
}
