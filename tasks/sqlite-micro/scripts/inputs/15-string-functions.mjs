const setup = `CREATE TABLE t (id INTEGER, s TEXT);
INSERT INTO t VALUES (1, 'Hello');
INSERT INTO t VALUES (2, 'WORLD');
INSERT INTO t VALUES (3, '  trim  ');
INSERT INTO t VALUES (4, 'a-b-c');
INSERT INTO t VALUES (5, 'xyz');`;

const valid = [
  { id: "string-functions-001", setup, query: "SELECT id, length(s) AS n FROM t ORDER BY id" },
  { id: "string-functions-002", setup, query: "SELECT length('abc') AS n" },
  { id: "string-functions-003", setup, query: "SELECT length('') AS n" },
  { id: "string-functions-004", setup, query: "SELECT id, lower(s) AS v FROM t ORDER BY id" },
  { id: "string-functions-005", setup, query: "SELECT lower('AbC') AS v" },
  { id: "string-functions-006", setup, query: "SELECT id, upper(s) AS v FROM t ORDER BY id" },
  { id: "string-functions-007", setup, query: "SELECT upper('AbC') AS v" },
  { id: "string-functions-008", setup, query: "SELECT id, substr(s, 1, 3) AS v FROM t ORDER BY id" },
  { id: "string-functions-009", setup, query: "SELECT substr('abcdef', 2, 2) AS v" },
  { id: "string-functions-010", setup, query: "SELECT substr('abcdef', -3) AS v" },
  { id: "string-functions-011", setup, query: "SELECT id, substring(s, 1, 2) AS v FROM t ORDER BY id" },
  { id: "string-functions-012", setup, query: "SELECT id, trim(s) AS v FROM t ORDER BY id" },
  { id: "string-functions-013", setup, query: "SELECT trim('  x  ') AS v" },
  { id: "string-functions-014", setup, query: "SELECT id, ltrim(s) AS v FROM t ORDER BY id" },
  { id: "string-functions-015", setup, query: "SELECT ltrim('  x') AS v" },
  { id: "string-functions-016", setup, query: "SELECT id, rtrim(s) AS v FROM t ORDER BY id" },
  { id: "string-functions-017", setup, query: "SELECT rtrim('x  ') AS v" },
  { id: "string-functions-018", setup, query: "SELECT id, replace(s, 'o', '0') AS v FROM t ORDER BY id" },
  { id: "string-functions-019", setup, query: "SELECT replace('aaa', 'a', 'b') AS v" },
  { id: "string-functions-020", setup, query: "SELECT id, s || '!' AS v FROM t ORDER BY id" },
  { id: "string-functions-021", setup, query: "SELECT 'a' || 'b' || 'c' AS v" },
  { id: "string-functions-022", setup, query: "SELECT id, 'id=' || id AS v FROM t ORDER BY id" },
  { id: "string-functions-023", setup, query: "SELECT id, trim(ltrim(rtrim(s))) AS v FROM t ORDER BY id" },
  { id: "string-functions-024", setup, query: "SELECT id, replace(replace(s, 'a', 'A'), 'e', 'E') AS v FROM t ORDER BY id" },
  { id: "string-functions-025", setup, query: "SELECT id, substr(s, 2) AS v FROM t ORDER BY id" },
  { id: "string-functions-026", setup, query: "SELECT substr('hello', 1, 10) AS v" },
  { id: "string-functions-027", setup, query: "SELECT length(trim('  abc  ')) AS n" },
  { id: "string-functions-028", setup, query: "SELECT id, upper(substr(s, 1, 1)) || lower(substr(s, 2)) AS v FROM t ORDER BY id" },
  { id: "string-functions-029", setup, query: "SELECT id, replace(s, '-', '') AS v FROM t WHERE id = 4" },
  { id: "string-functions-030", setup, query: "SELECT MAX(length(s)) AS mx FROM t" },
  { id: "string-functions-031", setup, query: "SELECT MIN(length(s)) AS mn FROM t" },
  { id: "string-functions-032", setup, query: "SELECT COUNT(*) AS n FROM t WHERE length(s) > 3" },
  { id: "string-functions-033", setup, query: "SELECT id FROM t WHERE lower(s) LIKE 'hello' ORDER BY id" },
  { id: "string-functions-034", setup, query: "SELECT id FROM t WHERE upper(s) = 'WORLD' ORDER BY id" },
  { id: "string-functions-035", setup, query: "SELECT id, trim(s, ' xyz') AS v FROM t WHERE id = 5" },
];

const invalid = [
  { id: "string-functions-090", sql: "SELECT length();", invalid: true },
  { id: "string-functions-091", sql: "SELECT lower('a', 'b');", invalid: true },
  { id: "string-functions-092", sql: "SELECT replace('a');", invalid: true },
  { id: "string-functions-093", sql: "SELECT trim('a', 'b', 'c');", invalid: true },
];

export default {
  section: "String Functions",
  cases: [...valid, ...invalid],
};
