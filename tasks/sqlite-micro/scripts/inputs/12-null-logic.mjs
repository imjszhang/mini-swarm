const setup = `CREATE TABLE t (id INTEGER, a INTEGER, b INTEGER, s TEXT);
INSERT INTO t VALUES (1, 1, 2, 'x');
INSERT INTO t VALUES (2, NULL, 3, 'y');
INSERT INTO t VALUES (3, 4, NULL, NULL);
INSERT INTO t VALUES (4, 5, 6, 'z');`;

const valid = [
  { id: "null-logic-001", setup, query: "SELECT id FROM t WHERE a IS NULL ORDER BY id" },
  { id: "null-logic-002", setup, query: "SELECT id FROM t WHERE a IS NOT NULL ORDER BY id" },
  { id: "null-logic-003", setup, query: "SELECT id FROM t WHERE b IS NULL ORDER BY id" },
  { id: "null-logic-004", setup, query: "SELECT id FROM t WHERE b IS NOT NULL ORDER BY id" },
  { id: "null-logic-005", setup, query: "SELECT id FROM t WHERE s IS NULL ORDER BY id" },
  { id: "null-logic-006", setup, query: "SELECT id FROM t WHERE s IS NOT NULL ORDER BY id" },
  { id: "null-logic-007", setup, query: "SELECT id, a + b AS sum FROM t ORDER BY id" },
  { id: "null-logic-008", setup, query: "SELECT id, a * b AS prod FROM t ORDER BY id" },
  { id: "null-logic-009", setup, query: "SELECT id, a - b AS diff FROM t ORDER BY id" },
  { id: "null-logic-010", setup, query: "SELECT id, a = b AS eq FROM t ORDER BY id" },
  { id: "null-logic-011", setup, query: "SELECT id, a <> b AS neq FROM t ORDER BY id" },
  { id: "null-logic-012", setup, query: "SELECT id, a < b AS lt FROM t ORDER BY id" },
  { id: "null-logic-013", setup, query: "SELECT id, a > b AS gt FROM t ORDER BY id" },
  { id: "null-logic-014", setup, query: "SELECT id, a <= b AS le FROM t ORDER BY id" },
  { id: "null-logic-015", setup, query: "SELECT id, a >= b AS ge FROM t ORDER BY id" },
  { id: "null-logic-016", setup, query: "SELECT id, a AND b AS band FROM t ORDER BY id" },
  { id: "null-logic-017", setup, query: "SELECT id, a OR b AS bor FROM t ORDER BY id" },
  { id: "null-logic-018", setup, query: "SELECT id, NOT a AS n FROM t ORDER BY id" },
  { id: "null-logic-019", setup, query: "SELECT id FROM t WHERE a = NULL ORDER BY id" },
  { id: "null-logic-020", setup, query: "SELECT id FROM t WHERE a <> NULL ORDER BY id" },
  { id: "null-logic-021", setup, query: "SELECT id FROM t WHERE NULL = a ORDER BY id" },
  { id: "null-logic-022", setup, query: "SELECT id FROM t WHERE a IS NULL OR b IS NULL ORDER BY id" },
  { id: "null-logic-023", setup, query: "SELECT id FROM t WHERE a IS NOT NULL AND b IS NOT NULL ORDER BY id" },
  { id: "null-logic-024", setup, query: "SELECT id FROM t WHERE s IS NULL OR s IS NOT NULL ORDER BY id" },
  { id: "null-logic-025", setup, query: "SELECT COUNT(*) AS n FROM t WHERE a IS NULL" },
  { id: "null-logic-026", setup, query: "SELECT COUNT(*) AS n FROM t WHERE s IS NOT NULL" },
  { id: "null-logic-027", setup, query: "SELECT id, s || '!' AS out FROM t ORDER BY id" },
  { id: "null-logic-028", setup, query: "SELECT NULL AS x" },
  { id: "null-logic-029", setup, query: "SELECT id, NULL + a AS n FROM t ORDER BY id" },
  { id: "null-logic-030", setup, query: "SELECT id, NULL AND 1 AS n FROM t ORDER BY id" },
  { id: "null-logic-031", setup, query: "SELECT id, NULL OR 0 AS n FROM t ORDER BY id" },
  { id: "null-logic-032", setup, query: "SELECT id FROM t WHERE (a IS NULL) = 1 ORDER BY id" },
  { id: "null-logic-033", setup, query: "SELECT id FROM t WHERE NOT (a IS NULL) ORDER BY id" },
  { id: "null-logic-034", setup, query: "SELECT id, CASE WHEN a IS NULL THEN 0 ELSE a END AS av FROM t ORDER BY id" },
  { id: "null-logic-035", setup, query: "SELECT id FROM t WHERE CASE WHEN a IS NULL THEN 0 ELSE a END > 0 ORDER BY id" },
];

const invalid = [
  { id: "null-logic-090", sql: "SELECT 1 WHERE NULL IS;", invalid: true },
  { id: "null-logic-091", sql: "SELECT 1 WHERE 1 IS NOT;", invalid: true },
  { id: "null-logic-092", sql: "SELECT 1 WHERE NULL IS NOT;", invalid: true },
  { id: "null-logic-093", sql: "SELECT NULL NULL;", invalid: true },
];

export default {
  section: "Null Logic",
  cases: [...valid, ...invalid],
};
