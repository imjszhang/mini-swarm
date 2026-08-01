const setup = `CREATE TABLE t (id INTEGER, v REAL, w INTEGER);
INSERT INTO t VALUES (1, -3.5, 10);
INSERT INTO t VALUES (2, 2.49, -4);
INSERT INTO t VALUES (3, 0.0, 0);
INSERT INTO t VALUES (4, 7.51, 3);
INSERT INTO t VALUES (5, NULL, 5);`;

const valid = [
  { id: "numeric-functions-001", setup, query: "SELECT id, abs(v) AS a FROM t ORDER BY id" },
  { id: "numeric-functions-002", setup, query: "SELECT abs(-42) AS a" },
  { id: "numeric-functions-003", setup, query: "SELECT abs(0) AS a" },
  { id: "numeric-functions-004", setup, query: "SELECT id, round(v) AS r FROM t ORDER BY id" },
  { id: "numeric-functions-005", setup, query: "SELECT round(3.14159, 2) AS r" },
  { id: "numeric-functions-006", setup, query: "SELECT round(2.5) AS r" },
  { id: "numeric-functions-007", setup, query: "SELECT id, round(v, 1) AS r FROM t ORDER BY id" },
  { id: "numeric-functions-008", setup, query: "SELECT min(3, 7) AS m" },
  { id: "numeric-functions-009", setup, query: "SELECT max(3, 7) AS m" },
  { id: "numeric-functions-010", setup, query: "SELECT id, min(v, w) AS m FROM t ORDER BY id" },
  { id: "numeric-functions-011", setup, query: "SELECT id, max(v, w) AS m FROM t ORDER BY id" },
  { id: "numeric-functions-012", setup, query: "SELECT typeof(1) AS t" },
  { id: "numeric-functions-013", setup, query: "SELECT typeof(1.5) AS t" },
  { id: "numeric-functions-014", setup, query: "SELECT typeof('x') AS t" },
  { id: "numeric-functions-015", setup, query: "SELECT typeof(NULL) AS t" },
  { id: "numeric-functions-016", setup, query: "SELECT id, typeof(v) AS tv FROM t ORDER BY id" },
  { id: "numeric-functions-017", setup, query: "SELECT abs(min(-1, -5)) AS a" },
  { id: "numeric-functions-018", setup, query: "SELECT max(abs(-2), abs(-8)) AS m" },
  { id: "numeric-functions-019", setup, query: "SELECT round(max(1.234, 5.678), 1) AS r" },
  { id: "numeric-functions-020", setup, query: "SELECT min(round(3.7), round(2.3)) AS m" },
  { id: "numeric-functions-021", setup, query: "SELECT id, abs(v) + abs(w) AS s FROM t ORDER BY id" },
  { id: "numeric-functions-022", setup, query: "SELECT SUM(abs(v)) AS total FROM t" },
  { id: "numeric-functions-023", setup, query: "SELECT AVG(round(v)) AS avg_r FROM t" },
  { id: "numeric-functions-024", setup, query: "SELECT MIN(min(v, w)) AS mn FROM t" },
  { id: "numeric-functions-025", setup, query: "SELECT MAX(max(v, w)) AS mx FROM t" },
  { id: "numeric-functions-026", setup, query: "SELECT COUNT(*) AS n FROM t WHERE abs(v) > 2" },
  { id: "numeric-functions-027", setup, query: "SELECT id FROM t WHERE round(v) = 3 ORDER BY id" },
  { id: "numeric-functions-028", setup, query: "SELECT id FROM t WHERE max(v, w) > 0 ORDER BY id" },
  { id: "numeric-functions-029", setup, query: "SELECT id FROM t WHERE min(v, w) < 0 ORDER BY id" },
  { id: "numeric-functions-030", setup, query: "SELECT round(-2.5) AS r" },
  { id: "numeric-functions-031", setup, query: "SELECT abs(NULL) AS a" },
  { id: "numeric-functions-032", setup, query: "SELECT round(NULL) AS r" },
  { id: "numeric-functions-033", setup, query: "SELECT min(NULL, 1) AS m" },
  { id: "numeric-functions-034", setup, query: "SELECT max(1, NULL) AS m" },
  { id: "numeric-functions-035", setup, query: "SELECT typeof(min(1, 2)) AS t" },
];

const invalid = [
  { id: "numeric-functions-090", sql: "SELECT abs();", invalid: true },
  { id: "numeric-functions-091", sql: "SELECT round(1, 2, 3);", invalid: true },
  { id: "numeric-functions-092", sql: "SELECT round();", invalid: true },
  { id: "numeric-functions-093", sql: "SELECT max();", invalid: true },
];

export default {
  section: "Numeric Functions",
  cases: [...valid, ...invalid],
};
