const baseSetup =
  "CREATE TABLE t (a INTEGER, b TEXT, c INTEGER);\nINSERT INTO t VALUES (1, 'a', 10);\nINSERT INTO t VALUES (2, 'b', 20);\nINSERT INTO t VALUES (3, 'c', 30);";

const valid = [
  {
    id: "select-core-001",
    setup: baseSetup,
    query: "SELECT a, b FROM t ORDER BY a",
  },
  {
    id: "select-core-002",
    setup: baseSetup,
    query: "SELECT * FROM t ORDER BY a",
  },
  {
    id: "select-core-003",
    setup: "CREATE TABLE t (a INTEGER);\nINSERT INTO t VALUES (5);",
    query: "SELECT a AS x FROM t",
  },
  {
    id: "select-core-004",
    setup: "CREATE TABLE t (a INTEGER, b INTEGER);\nINSERT INTO t VALUES (1, 2);",
    query: "SELECT a + b AS sum FROM t",
  },
  {
    id: "select-core-005",
    query: "SELECT 1 AS one, 'hi' AS s",
  },
  {
    id: "select-core-006",
    setup: "CREATE TABLE t (a INTEGER);\nINSERT INTO t VALUES (1);\nINSERT INTO t VALUES (2);\nINSERT INTO t VALUES (3);",
    query: "SELECT a FROM t ORDER BY a",
  },
  {
    id: "select-core-007",
    setup: "CREATE TABLE t (a INTEGER, b TEXT);\nINSERT INTO t VALUES (10, 'x');",
    query: "SELECT b, a FROM t",
  },
  {
    id: "select-core-008",
    setup: "CREATE TABLE t (a INTEGER);\nINSERT INTO t VALUES (1);",
    query: "SELECT a * 2 AS doubled FROM t",
  },
  {
    id: "select-core-009",
    setup: baseSetup,
    query: "SELECT c, a, b FROM t ORDER BY a",
  },
  {
    id: "select-core-010",
    setup: baseSetup,
    query: "SELECT a AS id, b AS name FROM t ORDER BY id",
  },
];

for (let i = 11; i <= 35; i++) {
  const n = String(i).padStart(3, "0");
  valid.push({
    id: `select-core-${n}`,
    setup: baseSetup,
    query: `SELECT a + ${i - 10} AS expr FROM t ORDER BY a`,
  });
}

const invalid = [
  { id: "select-core-090", sql: "SELECT a FROM nonexistent;", invalid: true },
  {
    id: "select-core-091",
    sql: "CREATE TABLE t (a INTEGER); SELECT b FROM t;",
    invalid: true,
  },
  { id: "select-core-092", sql: "SELECT;", invalid: true },
  { id: "select-core-093", sql: "SELECT FROM t;", invalid: true },
];

export default {
  section: "Select Core",
  cases: [...valid, ...invalid],
};
