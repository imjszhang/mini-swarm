const setup = `CREATE TABLE t (id INTEGER, category TEXT, amount INTEGER, flag INTEGER);
INSERT INTO t VALUES (1, 'a', 10, 1);
INSERT INTO t VALUES (2, 'b', 20, 0);
INSERT INTO t VALUES (3, 'a', 30, 1);
INSERT INTO t VALUES (4, 'c', NULL, 1);
INSERT INTO t VALUES (5, 'b', 50, NULL);`;

const valid = [
  { id: "aggregates-no-group-by-001", setup, query: "SELECT COUNT(*) AS n FROM t" },
  { id: "aggregates-no-group-by-002", setup, query: "SELECT COUNT(amount) AS n FROM t" },
  { id: "aggregates-no-group-by-003", setup, query: "SELECT COUNT(flag) AS n FROM t" },
  { id: "aggregates-no-group-by-004", setup, query: "SELECT SUM(amount) AS s FROM t" },
  { id: "aggregates-no-group-by-005", setup, query: "SELECT AVG(amount) AS a FROM t" },
  { id: "aggregates-no-group-by-006", setup, query: "SELECT MIN(amount) AS m FROM t" },
  { id: "aggregates-no-group-by-007", setup, query: "SELECT MAX(amount) AS m FROM t" },
  { id: "aggregates-no-group-by-008", setup, query: "SELECT MIN(id) AS m FROM t" },
  { id: "aggregates-no-group-by-009", setup, query: "SELECT MAX(id) AS m FROM t" },
  { id: "aggregates-no-group-by-010", setup, query: "SELECT SUM(id) AS s FROM t" },
  { id: "aggregates-no-group-by-011", setup, query: "SELECT AVG(id) AS a FROM t" },
  { id: "aggregates-no-group-by-012", setup, query: "SELECT COUNT(*) AS n FROM t WHERE category = 'a'" },
  { id: "aggregates-no-group-by-013", setup, query: "SELECT SUM(amount) AS s FROM t WHERE flag = 1" },
  { id: "aggregates-no-group-by-014", setup, query: "SELECT AVG(amount) AS a FROM t WHERE amount IS NOT NULL" },
  { id: "aggregates-no-group-by-015", setup, query: "SELECT MIN(category) AS m FROM t" },
  { id: "aggregates-no-group-by-016", setup, query: "SELECT MAX(category) AS m FROM t" },
  { id: "aggregates-no-group-by-017", setup, query: "SELECT COUNT(DISTINCT category) AS n FROM t" },
  { id: "aggregates-no-group-by-018", setup, query: "SELECT SUM(DISTINCT amount) AS s FROM t" },
  { id: "aggregates-no-group-by-019", setup: "CREATE TABLE empty (x INTEGER);", query: "SELECT COUNT(*) AS n FROM empty" },
  { id: "aggregates-no-group-by-020", setup: "CREATE TABLE empty (x INTEGER);", query: "SELECT SUM(x) AS s FROM empty" },
  { id: "aggregates-no-group-by-021", setup: "CREATE TABLE empty (x INTEGER);", query: "SELECT AVG(x) AS a FROM empty" },
  { id: "aggregates-no-group-by-022", setup: "CREATE TABLE empty (x INTEGER);", query: "SELECT MIN(x) AS m FROM empty" },
  { id: "aggregates-no-group-by-023", setup: "CREATE TABLE empty (x INTEGER);", query: "SELECT MAX(x) AS m FROM empty" },
  { id: "aggregates-no-group-by-024", setup: "CREATE TABLE one (v INTEGER); INSERT INTO one VALUES (7);", query: "SELECT COUNT(*) AS n FROM one" },
  { id: "aggregates-no-group-by-025", setup: "CREATE TABLE one (v INTEGER); INSERT INTO one VALUES (7);", query: "SELECT SUM(v) AS s FROM one" },
  { id: "aggregates-no-group-by-026", setup: "CREATE TABLE one (v INTEGER); INSERT INTO one VALUES (7);", query: "SELECT AVG(v) AS a FROM one" },
  { id: "aggregates-no-group-by-027", setup: "CREATE TABLE one (v INTEGER); INSERT INTO one VALUES (7);", query: "SELECT MIN(v) AS m FROM one" },
  { id: "aggregates-no-group-by-028", setup: "CREATE TABLE one (v INTEGER); INSERT INTO one VALUES (7);", query: "SELECT MAX(v) AS m FROM one" },
  { id: "aggregates-no-group-by-029", setup, query: "SELECT COUNT(*), SUM(amount), AVG(amount) FROM t" },
  { id: "aggregates-no-group-by-030", setup, query: "SELECT MIN(amount) AS mn, MAX(amount) AS mx FROM t" },
  { id: "aggregates-no-group-by-031", setup, query: "SELECT SUM(amount + id) AS s FROM t" },
  { id: "aggregates-no-group-by-032", setup, query: "SELECT AVG(amount * 2) AS a FROM t" },
  { id: "aggregates-no-group-by-033", setup, query: "SELECT COUNT(*) AS n FROM t WHERE amount > 15" },
  { id: "aggregates-no-group-by-034", setup, query: "SELECT SUM(CASE WHEN flag = 1 THEN amount ELSE 0 END) AS s FROM t" },
  { id: "aggregates-no-group-by-035", setup, query: "SELECT MAX(length(category)) AS m FROM t" },
];

const invalid = [
  { id: "aggregates-no-group-by-090", sql: "SELECT SUM();", invalid: true },
  { id: "aggregates-no-group-by-091", sql: "SELECT AVG();", invalid: true },
  { id: "aggregates-no-group-by-092", sql: "SELECT COUNT;", invalid: true },
  { id: "aggregates-no-group-by-093", sql: "SELECT COUNT(1, 2);", invalid: true },
];

export default {
  section: "Aggregates No Group By",
  cases: [...valid, ...invalid],
};
