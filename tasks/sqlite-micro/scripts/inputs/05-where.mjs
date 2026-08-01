const baseSetup =
  "CREATE TABLE t (id INTEGER, name TEXT, score INTEGER);\nINSERT INTO t VALUES (1, 'alice', 80);\nINSERT INTO t VALUES (2, 'bob', 90);\nINSERT INTO t VALUES (3, 'carol', 70);\nINSERT INTO t VALUES (4, 'dave', 90);";

const valid = [
  {
    id: "where-001",
    setup: baseSetup,
    query: "SELECT id, name FROM t WHERE id = 2 ORDER BY id",
  },
  {
    id: "where-002",
    setup: baseSetup,
    query: "SELECT id FROM t WHERE id <> 2 ORDER BY id",
  },
  {
    id: "where-003",
    setup: baseSetup,
    query: "SELECT id FROM t WHERE score > 80 ORDER BY id",
  },
  {
    id: "where-004",
    setup: baseSetup,
    query: "SELECT id FROM t WHERE score < 80 ORDER BY id",
  },
  {
    id: "where-005",
    setup: baseSetup,
    query: "SELECT id FROM t WHERE score >= 90 ORDER BY id",
  },
  {
    id: "where-006",
    setup: baseSetup,
    query: "SELECT id FROM t WHERE score <= 70 ORDER BY id",
  },
  {
    id: "where-007",
    setup: baseSetup,
    query: "SELECT id FROM t WHERE score = 90 ORDER BY id",
  },
  {
    id: "where-008",
    setup: baseSetup,
    query: "SELECT id FROM t WHERE id = 1 AND score = 80",
  },
  {
    id: "where-009",
    setup: baseSetup,
    query: "SELECT id FROM t WHERE id = 1 OR id = 3 ORDER BY id",
  },
  {
    id: "where-010",
    setup: baseSetup,
    query: "SELECT id FROM t WHERE (id = 2 OR id = 4) AND score = 90 ORDER BY id",
  },
];

for (let i = 11; i <= 35; i++) {
  const n = String(i).padStart(3, "0");
  const threshold = 70 + ((i - 11) % 21);
  valid.push({
    id: `where-${n}`,
    setup: baseSetup,
    query: `SELECT id, score FROM t WHERE score >= ${threshold} ORDER BY id`,
  });
}

const invalid = [
  {
    id: "where-090",
    sql: "CREATE TABLE t (a INTEGER); SELECT a FROM t WHERE;",
    invalid: true,
  },
  {
    id: "where-091",
    sql: "CREATE TABLE t (a INTEGER); SELECT a FROM t WHERE a =;",
    invalid: true,
  },
  {
    id: "where-092",
    sql: "SELECT id FROM t WHERE id = 1;",
    invalid: true,
  },
  {
    id: "where-093",
    sql: "CREATE TABLE t (a INTEGER); SELECT a FROM t WERE a = 1;",
    invalid: true,
  },
];

export default {
  section: "Where",
  cases: [...valid, ...invalid],
};
