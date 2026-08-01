const valid = [
  {
    id: "insert-001",
    setup: "CREATE TABLE t (a INTEGER, b TEXT);\nINSERT INTO t VALUES (1, 'x');",
    query: "SELECT a, b FROM t ORDER BY a",
  },
  {
    id: "insert-002",
    setup: "CREATE TABLE t (a INTEGER, b TEXT);\nINSERT INTO t VALUES (1, 'a');\nINSERT INTO t VALUES (2, 'b');",
    query: "SELECT a, b FROM t ORDER BY a",
  },
  {
    id: "insert-003",
    setup: "CREATE TABLE t (a INTEGER, b TEXT, c INTEGER);\nINSERT INTO t (a, c) VALUES (5, 10);",
    query: "SELECT a, b, c FROM t",
  },
  {
    id: "insert-004",
    setup: "CREATE TABLE t (a INTEGER);\nINSERT INTO t VALUES (NULL);",
    query: "SELECT a FROM t",
  },
  {
    id: "insert-005",
    setup: "CREATE TABLE t (a INTEGER, b TEXT);\nINSERT INTO t (b, a) VALUES ('z', 3);",
    query: "SELECT a, b FROM t",
  },
  {
    id: "insert-006",
    setup:
      "CREATE TABLE t (a INTEGER, b TEXT);\nINSERT INTO t VALUES (1, 'a'), (2, 'b'), (3, 'c');",
    query: "SELECT a, b FROM t ORDER BY a",
  },
  {
    id: "insert-007",
    setup: "CREATE TABLE t (a INTEGER);\nINSERT INTO t VALUES (10);\nINSERT INTO t VALUES (20);",
    query: "SELECT COUNT(*) FROM t",
  },
  {
    id: "insert-008",
    setup: "CREATE TABLE t (a INTEGER, b TEXT);\nINSERT INTO t VALUES (1, NULL);",
    query: "SELECT a, b FROM t",
  },
  {
    id: "insert-009",
    setup: "CREATE TABLE t (a INTEGER, b TEXT);\nINSERT INTO t VALUES ('7', 8);",
    query: "SELECT a, b FROM t",
  },
  {
    id: "insert-010",
    setup: "CREATE TABLE t (a INTEGER, b REAL);\nINSERT INTO t VALUES (1, '3.5');",
    query: "SELECT a, b FROM t",
  },
];

for (let i = 11; i <= 35; i++) {
  const n = String(i).padStart(3, "0");
  valid.push({
    id: `insert-${n}`,
    setup: `CREATE TABLE ins_${i} (id INTEGER, tag TEXT);\nINSERT INTO ins_${i} VALUES (${i}, 't${i}');\nINSERT INTO ins_${i} (tag, id) VALUES ('u${i}', ${i + 100});`,
    query: `SELECT id, tag FROM ins_${i} ORDER BY id`,
  });
}

const invalid = [
  {
    id: "insert-090",
    sql: "CREATE TABLE t (a INTEGER, b TEXT); INSERT INTO t VALUES (1);",
    invalid: true,
  },
  {
    id: "insert-091",
    sql: "CREATE TABLE t (a INTEGER); INSERT INTO t (b) VALUES (1);",
    invalid: true,
  },
  {
    id: "insert-092",
    sql: "INSERT INTO missing_table VALUES (1);",
    invalid: true,
  },
  {
    id: "insert-093",
    sql: "CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1, 2);",
    invalid: true,
  },
];

export default {
  section: "Insert",
  cases: [...valid, ...invalid],
};
