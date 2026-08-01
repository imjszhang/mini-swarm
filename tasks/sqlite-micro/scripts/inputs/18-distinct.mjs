const setup = `CREATE TABLE t (id INTEGER, color TEXT, size INTEGER);
INSERT INTO t VALUES (1, 'red', 3);
INSERT INTO t VALUES (2, 'blue', 1);
INSERT INTO t VALUES (3, 'red', 2);
INSERT INTO t VALUES (4, 'green', 3);
INSERT INTO t VALUES (5, 'blue', 1);
INSERT INTO t VALUES (6, 'red', 2);`;

const valid = [
  { id: "distinct-001", setup, query: "SELECT DISTINCT color FROM t ORDER BY color" },
  { id: "distinct-002", setup, query: "SELECT DISTINCT size FROM t ORDER BY size" },
  { id: "distinct-003", setup, query: "SELECT DISTINCT color, size FROM t ORDER BY color, size" },
  { id: "distinct-004", setup, query: "SELECT DISTINCT size, color FROM t ORDER BY size, color" },
  { id: "distinct-005", setup, query: "SELECT DISTINCT color FROM t ORDER BY color DESC" },
  { id: "distinct-006", setup, query: "SELECT DISTINCT size FROM t ORDER BY size DESC" },
  { id: "distinct-007", setup, query: "SELECT DISTINCT color FROM t WHERE size > 1 ORDER BY color" },
  { id: "distinct-008", setup, query: "SELECT DISTINCT size FROM t WHERE color <> 'green' ORDER BY size" },
  { id: "distinct-009", setup, query: "SELECT DISTINCT color FROM t ORDER BY 1" },
  { id: "distinct-010", setup, query: "SELECT DISTINCT size FROM t ORDER BY 1 DESC" },
  { id: "distinct-011", setup, query: "SELECT COUNT(DISTINCT color) AS n FROM t" },
  { id: "distinct-012", setup, query: "SELECT DISTINCT color || '-' || size AS cs FROM t ORDER BY cs" },
  { id: "distinct-013", setup, query: "SELECT DISTINCT length(color) AS n FROM t ORDER BY n" },
  { id: "distinct-014", setup, query: "SELECT DISTINCT upper(color) AS c FROM t ORDER BY c" },
  { id: "distinct-015", setup, query: "SELECT DISTINCT lower(color) AS c FROM t ORDER BY c" },
  { id: "distinct-016", setup, query: "SELECT DISTINCT id % 2 AS parity FROM t ORDER BY parity" },
  { id: "distinct-017", setup, query: "SELECT DISTINCT size + 1 AS s FROM t ORDER BY s" },
  { id: "distinct-018", setup, query: "SELECT DISTINCT color FROM t WHERE id BETWEEN 2 AND 5 ORDER BY color" },
  { id: "distinct-019", setup, query: "SELECT DISTINCT size FROM t WHERE color IN ('red', 'blue') ORDER BY size" },
  { id: "distinct-020", setup, query: "SELECT DISTINCT color FROM t WHERE color LIKE '%e%' ORDER BY color" },
  { id: "distinct-021", setup: "CREATE TABLE d (v INTEGER); INSERT INTO d VALUES (1); INSERT INTO d VALUES (1); INSERT INTO d VALUES (2);", query: "SELECT DISTINCT v FROM d ORDER BY v" },
  { id: "distinct-022", setup: "CREATE TABLE d (v INTEGER); INSERT INTO d VALUES (1); INSERT INTO d VALUES (1);", query: "SELECT DISTINCT v FROM d" },
  { id: "distinct-023", setup: "CREATE TABLE d (a TEXT, b TEXT); INSERT INTO d VALUES ('x', 'y'); INSERT INTO d VALUES ('x', 'y'); INSERT INTO d VALUES ('x', 'z');", query: "SELECT DISTINCT a, b FROM d ORDER BY a, b" },
  { id: "distinct-024", setup: "CREATE TABLE d (v TEXT); INSERT INTO d VALUES (NULL); INSERT INTO d VALUES (NULL); INSERT INTO d VALUES ('a');", query: "SELECT DISTINCT v FROM d ORDER BY v" },
  { id: "distinct-025", setup, query: "SELECT DISTINCT color FROM t ORDER BY color ASC" },
  { id: "distinct-026", setup, query: "SELECT DISTINCT size FROM t ORDER BY size ASC, color" },
  { id: "distinct-027", setup, query: "SELECT DISTINCT color FROM t ORDER BY length(color)" },
  { id: "distinct-028", setup, query: "SELECT DISTINCT CASE WHEN size = 1 THEN 'small' ELSE 'big' END AS bucket FROM t ORDER BY bucket" },
  { id: "distinct-029", setup, query: "SELECT DISTINCT CAST(size AS TEXT) AS s FROM t ORDER BY s" },
  { id: "distinct-030", setup, query: "SELECT DISTINCT color FROM t WHERE NOT (size = 1 AND color = 'blue') ORDER BY color" },
  { id: "distinct-031", setup, query: "SELECT DISTINCT color FROM t ORDER BY color LIMIT 2" },
  { id: "distinct-032", setup, query: "SELECT DISTINCT size FROM t ORDER BY size LIMIT 10 OFFSET 0" },
  { id: "distinct-033", setup, query: "SELECT DISTINCT abs(size - 2) AS d FROM t ORDER BY d" },
  { id: "distinct-034", setup, query: "SELECT DISTINCT min(size, 2) AS m FROM t ORDER BY m" },
  { id: "distinct-035", setup, query: "SELECT DISTINCT color FROM t ORDER BY color, size DESC" },
];

const invalid = [
  { id: "distinct-090", sql: "CREATE TABLE t (a INTEGER); SELECT DISTINCT FROM t;", invalid: true },
  { id: "distinct-091", sql: "SELECT DISTINCT DISTINCT 1;", invalid: true },
  { id: "distinct-092", sql: "SELECT DISTINCT 1, FROM t;", invalid: true },
  { id: "distinct-093", sql: "SELECT DISTINCT;", invalid: true },
];

export default {
  section: "Distinct",
  cases: [...valid, ...invalid],
};
