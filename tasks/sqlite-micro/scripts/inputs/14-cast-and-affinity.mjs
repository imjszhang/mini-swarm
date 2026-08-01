const setupMixed = `CREATE TABLE mixed (i INTEGER, r REAL, s TEXT);
INSERT INTO mixed VALUES ('42', 3.7, 100);
INSERT INTO mixed VALUES ('7.9', '2.5', '3.14');
INSERT INTO mixed VALUES ('abc', 1.0, 5);`;

const setupTyped = `CREATE TABLE typed (i INTEGER, r REAL, t TEXT, n NUMERIC);
INSERT INTO typed VALUES ('10', '20.5', 123, '99.9');
INSERT INTO typed VALUES (3.14, '7', '45.6', 1);
INSERT INTO typed VALUES ('x', 0, '0', '0');`;

const valid = [
  { id: "cast-and-affinity-001", setup: setupMixed, query: "SELECT CAST(i AS INTEGER) AS v FROM mixed ORDER BY rowid" },
  { id: "cast-and-affinity-002", setup: setupMixed, query: "SELECT CAST(r AS REAL) AS v FROM mixed ORDER BY rowid" },
  { id: "cast-and-affinity-003", setup: setupMixed, query: "SELECT CAST(s AS TEXT) AS v FROM mixed ORDER BY rowid" },
  { id: "cast-and-affinity-004", setup: setupMixed, query: "SELECT CAST(s AS INTEGER) AS v FROM mixed ORDER BY rowid" },
  { id: "cast-and-affinity-005", setup: setupMixed, query: "SELECT CAST(s AS REAL) AS v FROM mixed ORDER BY rowid" },
  { id: "cast-and-affinity-006", setup: setupMixed, query: "SELECT CAST(i AS TEXT) AS v FROM mixed ORDER BY rowid" },
  { id: "cast-and-affinity-007", setup: setupMixed, query: "SELECT CAST(r AS INTEGER) AS v FROM mixed ORDER BY rowid" },
  { id: "cast-and-affinity-008", setup: setupMixed, query: "SELECT CAST('99' AS INTEGER) AS v" },
  { id: "cast-and-affinity-009", setup: setupMixed, query: "SELECT CAST('3.5' AS REAL) AS v" },
  { id: "cast-and-affinity-010", setup: setupMixed, query: "SELECT CAST(123 AS TEXT) AS v" },
  { id: "cast-and-affinity-011", setup: setupMixed, query: "SELECT CAST(NULL AS INTEGER) AS v" },
  { id: "cast-and-affinity-012", setup: setupMixed, query: "SELECT CAST(NULL AS TEXT) AS v" },
  { id: "cast-and-affinity-013", setup: setupMixed, query: "SELECT CAST('abc' AS INTEGER) AS v" },
  { id: "cast-and-affinity-014", setup: setupMixed, query: "SELECT CAST('3.14' AS NUMERIC) AS v" },
  { id: "cast-and-affinity-015", setup: setupMixed, query: "SELECT CAST(5 AS NUMERIC) AS v" },
  { id: "cast-and-affinity-016", setup: setupTyped, query: "SELECT i, typeof(i) AS ti FROM typed ORDER BY rowid" },
  { id: "cast-and-affinity-017", setup: setupTyped, query: "SELECT r, typeof(r) AS tr FROM typed ORDER BY rowid" },
  { id: "cast-and-affinity-018", setup: setupTyped, query: "SELECT t, typeof(t) AS tt FROM typed ORDER BY rowid" },
  { id: "cast-and-affinity-019", setup: setupTyped, query: "SELECT n, typeof(n) AS tn FROM typed ORDER BY rowid" },
  { id: "cast-and-affinity-020", setup: setupTyped, query: "SELECT i + 1 AS v FROM typed ORDER BY rowid" },
  { id: "cast-and-affinity-021", setup: setupTyped, query: "SELECT r * 2 AS v FROM typed ORDER BY rowid" },
  { id: "cast-and-affinity-022", setup: setupTyped, query: "SELECT t || '!' AS v FROM typed ORDER BY rowid" },
  { id: "cast-and-affinity-023", setup: setupTyped, query: "SELECT n + 0 AS v FROM typed ORDER BY rowid" },
  { id: "cast-and-affinity-024", setup: "CREATE TABLE nums (v INTEGER); INSERT INTO nums VALUES ('15'); INSERT INTO nums VALUES ('8');", query: "SELECT v FROM nums ORDER BY v" },
  { id: "cast-and-affinity-025", setup: "CREATE TABLE nums (v REAL); INSERT INTO nums VALUES ('2.5'); INSERT INTO nums VALUES ('4');", query: "SELECT v FROM nums ORDER BY v" },
  { id: "cast-and-affinity-026", setup: "CREATE TABLE nums (v TEXT); INSERT INTO nums VALUES (100); INSERT INTO nums VALUES (200);", query: "SELECT v FROM nums ORDER BY v" },
  { id: "cast-and-affinity-027", setup: "CREATE TABLE nums (v NUMERIC); INSERT INTO nums VALUES ('12.3'); INSERT INTO nums VALUES (7);", query: "SELECT v FROM nums ORDER BY v" },
  { id: "cast-and-affinity-028", setup: setupMixed, query: "SELECT CAST(CAST(i AS TEXT) AS INTEGER) AS v FROM mixed ORDER BY rowid" },
  { id: "cast-and-affinity-029", setup: setupMixed, query: "SELECT CAST(r AS TEXT) || 'x' AS v FROM mixed ORDER BY rowid" },
  { id: "cast-and-affinity-030", setup: setupMixed, query: "SELECT SUM(CAST(s AS INTEGER)) AS total FROM mixed" },
  { id: "cast-and-affinity-031", setup: setupMixed, query: "SELECT AVG(CAST(i AS REAL)) AS avg_i FROM mixed" },
  { id: "cast-and-affinity-032", setup: setupMixed, query: "SELECT MAX(CAST(s AS INTEGER)) AS mx FROM mixed" },
  { id: "cast-and-affinity-033", setup: setupMixed, query: "SELECT MIN(CAST(i AS INTEGER)) AS mn FROM mixed" },
  { id: "cast-and-affinity-034", setup: setupMixed, query: "SELECT CAST(i AS REAL) + CAST(r AS REAL) AS sum FROM mixed ORDER BY rowid" },
  { id: "cast-and-affinity-035", setup: setupTyped, query: "SELECT COUNT(*) AS n FROM typed WHERE CAST(t AS INTEGER) > 0" },
];

const invalid = [
  { id: "cast-and-affinity-090", sql: "SELECT CAST(1);", invalid: true },
  { id: "cast-and-affinity-091", sql: "SELECT CAST AS INTEGER;", invalid: true },
  { id: "cast-and-affinity-092", sql: "SELECT CAST(1 + AS INTEGER);", invalid: true },
  { id: "cast-and-affinity-093", sql: "SELECT CAST();", invalid: true },
];

export default {
  section: "Cast And Affinity",
  cases: [...valid, ...invalid],
};
