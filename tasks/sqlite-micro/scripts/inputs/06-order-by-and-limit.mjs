const baseSetup =
  "CREATE TABLE t (id INTEGER, name TEXT, rank INTEGER);\nINSERT INTO t VALUES (3, 'c', 30);\nINSERT INTO t VALUES (1, 'a', 10);\nINSERT INTO t VALUES (2, 'b', 20);\nINSERT INTO t VALUES (4, 'd', 20);";

const valid = [
  {
    id: "order-by-and-limit-001",
    setup: baseSetup,
    query: "SELECT id FROM t ORDER BY id",
  },
  {
    id: "order-by-and-limit-002",
    setup: baseSetup,
    query: "SELECT id FROM t ORDER BY id DESC",
  },
  {
    id: "order-by-and-limit-003",
    setup: baseSetup,
    query: "SELECT id, rank FROM t ORDER BY rank, id",
  },
  {
    id: "order-by-and-limit-004",
    setup: baseSetup,
    query: "SELECT id, rank FROM t ORDER BY rank DESC, id ASC",
  },
  {
    id: "order-by-and-limit-005",
    setup: baseSetup,
    query: "SELECT id FROM t ORDER BY id LIMIT 2",
  },
  {
    id: "order-by-and-limit-006",
    setup: baseSetup,
    query: "SELECT id FROM t ORDER BY id LIMIT 2 OFFSET 1",
  },
  {
    id: "order-by-and-limit-007",
    setup: baseSetup,
    query: "SELECT id FROM t ORDER BY id DESC LIMIT 1",
  },
  {
    id: "order-by-and-limit-008",
    setup: baseSetup,
    query: "SELECT name FROM t ORDER BY name",
  },
  {
    id: "order-by-and-limit-009",
    setup: baseSetup,
    query: "SELECT id FROM t ORDER BY id LIMIT 10",
  },
  {
    id: "order-by-and-limit-010",
    setup: baseSetup,
    query: "SELECT id FROM t ORDER BY id LIMIT 0",
  },
];

for (let i = 11; i <= 35; i++) {
  const n = String(i).padStart(3, "0");
  const limit = (i - 10) % 5;
  const offset = (i - 11) % 3;
  valid.push({
    id: `order-by-and-limit-${n}`,
    setup: baseSetup,
    query: `SELECT id, rank FROM t ORDER BY rank DESC, id LIMIT ${limit} OFFSET ${offset}`,
  });
}

const invalid = [
  {
    id: "order-by-and-limit-090",
    sql: "CREATE TABLE t (a INTEGER); SELECT a FROM t ORDER BY;",
    invalid: true,
  },
  {
    id: "order-by-and-limit-091",
    sql: "CREATE TABLE t (a INTEGER); SELECT a FROM t ORDER BY a LIMT 1;",
    invalid: true,
  },
  {
    id: "order-by-and-limit-092",
    sql: "CREATE TABLE t (a INTEGER); SELECT a FROM t LIMIT;",
    invalid: true,
  },
  {
    id: "order-by-and-limit-093",
    sql: "CREATE TABLE t (a INTEGER); SELECT a FROM t ORDER BY a OFFEST 1;",
    invalid: true,
  },
];

export default {
  section: "Order By And Limit",
  cases: [...valid, ...invalid],
};
