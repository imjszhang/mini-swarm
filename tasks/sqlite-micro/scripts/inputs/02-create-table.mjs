const valid = [
  {
    id: "create-table-001",
    setup: "CREATE TABLE t (a INTEGER, b TEXT);\nINSERT INTO t VALUES (1, 'x');",
    query: "SELECT a, b FROM t ORDER BY a",
  },
  {
    id: "create-table-002",
    setup: "CREATE TABLE nums (n INTEGER);\nINSERT INTO nums VALUES (10);",
    query: "SELECT n FROM nums",
  },
  {
    id: "create-table-003",
    setup: "CREATE TABLE mixed (i INTEGER, r REAL, s TEXT);\nINSERT INTO mixed VALUES (1, 2.5, 'hi');",
    query: "SELECT i, r, s FROM mixed",
  },
  {
    id: "create-table-004",
    setup: "CREATE TABLE empty (a INTEGER);",
    query: "SELECT a FROM empty",
  },
  {
    id: "create-table-005",
    setup:
      "CREATE TABLE t1 (x INTEGER);\nCREATE TABLE t2 (y TEXT);\nINSERT INTO t1 VALUES (7);\nINSERT INTO t2 VALUES ('z');",
    query: "SELECT x FROM t1",
  },
  {
    id: "create-table-006",
    setup: "CREATE TABLE \"Weird Name\" (a INTEGER);\nINSERT INTO \"Weird Name\" VALUES (3);",
    query: "SELECT a FROM \"Weird Name\"",
  },
  {
    id: "create-table-007",
    setup: "CREATE TABLE t (col_a INTEGER, col_b INTEGER);\nINSERT INTO t VALUES (1, 2);",
    query: "SELECT col_a, col_b FROM t",
  },
  {
    id: "create-table-008",
    setup: "CREATE TABLE t (a INTEGER);\nINSERT INTO t VALUES (NULL);",
    query: "SELECT a FROM t",
  },
  {
    id: "create-table-009",
    setup: "CREATE TABLE t (a INTEGER, b TEXT, c REAL);\nINSERT INTO t VALUES (1, 'a', 1.0);",
    query: "SELECT a, b, c FROM t",
  },
  {
    id: "create-table-010",
    setup: "CREATE TABLE \"select\" (\"from\" INTEGER);\nINSERT INTO \"select\" VALUES (99);",
    query: "SELECT \"from\" FROM \"select\"",
  },
];

for (let i = 11; i <= 35; i++) {
  const n = String(i).padStart(3, "0");
  valid.push({
    id: `create-table-${n}`,
    setup: `CREATE TABLE tbl_${i} (id INTEGER, val TEXT);\nINSERT INTO tbl_${i} VALUES (${i}, 'v${i}');`,
    query: `SELECT id, val FROM tbl_${i} ORDER BY id`,
  });
}

const invalid = [
  {
    id: "create-table-090",
    sql: "CREATE TABLE t (a INTEGER); CREATE TABLE t (b TEXT);",
    invalid: true,
  },
  { id: "create-table-091", sql: "CREATE TABLE (a INTEGER);", invalid: true },
  { id: "create-table-092", sql: "CREATE TABLE t ();", invalid: true },
  { id: "create-table-093", sql: "CREATE TABLE t a INTEGER);", invalid: true },
];

export default {
  section: "Create Table",
  cases: [...valid, ...invalid],
};
