const setup = `CREATE TABLE t (id INTEGER, name TEXT, score INTEGER, tag TEXT);
INSERT INTO t VALUES (1, 'alpha', 10, 'a');
INSERT INTO t VALUES (2, 'beta', 20, 'b');
INSERT INTO t VALUES (3, 'gamma', 30, 'c');
INSERT INTO t VALUES (4, 'delta', 40, 'd');
INSERT INTO t VALUES (5, 'echo', 50, 'e');`;

const valid = [
  { id: "between-in-like-001", setup, query: "SELECT id, name FROM t WHERE score BETWEEN 20 AND 40 ORDER BY id" },
  { id: "between-in-like-002", setup, query: "SELECT id FROM t WHERE score BETWEEN 10 AND 10 ORDER BY id" },
  { id: "between-in-like-003", setup, query: "SELECT id FROM t WHERE score NOT BETWEEN 20 AND 40 ORDER BY id" },
  { id: "between-in-like-004", setup, query: "SELECT id FROM t WHERE score BETWEEN 15 AND 25 ORDER BY id" },
  { id: "between-in-like-005", setup, query: "SELECT id FROM t WHERE score BETWEEN 0 AND 100 ORDER BY id" },
  { id: "between-in-like-006", setup, query: "SELECT COUNT(*) AS n FROM t WHERE score BETWEEN 20 AND 40" },
  { id: "between-in-like-007", setup, query: "SELECT id FROM t WHERE id BETWEEN 2 AND 4 ORDER BY id" },
  { id: "between-in-like-008", setup, query: "SELECT id FROM t WHERE id NOT BETWEEN 2 AND 4 ORDER BY id" },
  { id: "between-in-like-009", setup, query: "SELECT id FROM t WHERE name BETWEEN 'beta' AND 'delta' ORDER BY id" },
  { id: "between-in-like-010", setup, query: "SELECT id FROM t WHERE name NOT BETWEEN 'beta' AND 'delta' ORDER BY id" },
  { id: "between-in-like-011", setup, query: "SELECT id FROM t WHERE score IN (10, 30, 50) ORDER BY id" },
  { id: "between-in-like-012", setup, query: "SELECT id FROM t WHERE score IN (20) ORDER BY id" },
  { id: "between-in-like-013", setup, query: "SELECT id FROM t WHERE score NOT IN (10, 30, 50) ORDER BY id" },
  { id: "between-in-like-014", setup, query: "SELECT id FROM t WHERE id IN (1, 3, 5) ORDER BY id" },
  { id: "between-in-like-015", setup, query: "SELECT id FROM t WHERE id NOT IN (2, 4) ORDER BY id" },
  { id: "between-in-like-016", setup, query: "SELECT id FROM t WHERE tag IN ('a', 'c', 'e') ORDER BY id" },
  { id: "between-in-like-017", setup, query: "SELECT id FROM t WHERE tag NOT IN ('b', 'd') ORDER BY id" },
  { id: "between-in-like-018", setup, query: "SELECT COUNT(*) AS n FROM t WHERE score IN (20, 30, 40)" },
  { id: "between-in-like-019", setup, query: "SELECT id FROM t WHERE name LIKE 'a%' ORDER BY id" },
  { id: "between-in-like-020", setup, query: "SELECT id FROM t WHERE name LIKE '%ma' ORDER BY id" },
  { id: "between-in-like-021", setup, query: "SELECT id FROM t WHERE name LIKE '%ta%' ORDER BY id" },
  { id: "between-in-like-022", setup, query: "SELECT id FROM t WHERE name LIKE 'b_ta' ORDER BY id" },
  { id: "between-in-like-023", setup, query: "SELECT id FROM t WHERE name LIKE '_____' ORDER BY id" },
  { id: "between-in-like-024", setup, query: "SELECT id FROM t WHERE name NOT LIKE 'a%' ORDER BY id" },
  { id: "between-in-like-025", setup, query: "SELECT id FROM t WHERE name NOT LIKE '%ma' ORDER BY id" },
  { id: "between-in-like-026", setup, query: "SELECT id FROM t WHERE tag LIKE '[a-e]' ESCAPE '[' ORDER BY id" },
  { id: "between-in-like-027", setup, query: "SELECT id FROM t WHERE name LIKE '%' ORDER BY id" },
  { id: "between-in-like-028", setup, query: "SELECT id FROM t WHERE name LIKE '%%' ORDER BY id" },
  { id: "between-in-like-029", setup, query: "SELECT id FROM t WHERE score BETWEEN 25 AND 35 OR score = 10 ORDER BY id" },
  { id: "between-in-like-030", setup, query: "SELECT id FROM t WHERE score IN (10, 20) AND tag IN ('a', 'b') ORDER BY id" },
  { id: "between-in-like-031", setup, query: "SELECT id FROM t WHERE name LIKE 'g_mma' AND score BETWEEN 25 AND 35 ORDER BY id" },
  { id: "between-in-like-032", setup, query: "SELECT id FROM t WHERE NOT (score BETWEEN 1 AND 9) ORDER BY id" },
  { id: "between-in-like-033", setup, query: "SELECT id FROM t WHERE score NOT IN (99, 100) ORDER BY id" },
  { id: "between-in-like-034", setup, query: "SELECT id FROM t WHERE name LIKE 'e_ho' ORDER BY id" },
  { id: "between-in-like-035", setup, query: "SELECT id FROM t WHERE id BETWEEN score - 5 AND score + 5 ORDER BY id" },
];

const invalid = [
  { id: "between-in-like-090", sql: "CREATE TABLE t (a INTEGER); SELECT a FROM t WHERE a BETWEEN 1;", invalid: true },
  { id: "between-in-like-091", sql: "CREATE TABLE t (a INTEGER); SELECT a FROM t WHERE a IN;", invalid: true },
  { id: "between-in-like-092", sql: "CREATE TABLE t (a TEXT); SELECT a FROM t WHERE a LIKE;", invalid: true },
  { id: "between-in-like-093", sql: "CREATE TABLE t (a INTEGER); SELECT a FROM t WHERE a NOT IN (1,);", invalid: true },
];

export default {
  section: "Between In Like",
  cases: [...valid, ...invalid],
};
