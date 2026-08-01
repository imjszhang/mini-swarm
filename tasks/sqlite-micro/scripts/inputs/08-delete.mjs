const baseSetup =
  "CREATE TABLE t (id INTEGER, name TEXT);\nINSERT INTO t VALUES (1, 'a');\nINSERT INTO t VALUES (2, 'b');\nINSERT INTO t VALUES (3, 'c');\nINSERT INTO t VALUES (4, 'd');";

const valid = [
  {
    id: "delete-001",
    setup: baseSetup + "\nDELETE FROM t WHERE id = 2;",
    query: "SELECT id FROM t ORDER BY id",
  },
  {
    id: "delete-002",
    setup: baseSetup + "\nDELETE FROM t WHERE id > 2;",
    query: "SELECT id FROM t ORDER BY id",
  },
  {
    id: "delete-003",
    setup: baseSetup + "\nDELETE FROM t;",
    query: "SELECT COUNT(*) FROM t",
  },
  {
    id: "delete-004",
    setup: baseSetup + "\nDELETE FROM t WHERE id = 1 OR id = 4;",
    query: "SELECT id FROM t ORDER BY id",
  },
  {
    id: "delete-005",
    setup: baseSetup + "\nDELETE FROM t WHERE name = 'b';",
    query: "SELECT id, name FROM t ORDER BY id",
  },
  {
    id: "delete-006",
    setup: baseSetup + "\nDELETE FROM t WHERE id <> 3;",
    query: "SELECT id FROM t",
  },
  {
    id: "delete-007",
    setup: baseSetup + "\nDELETE FROM t WHERE id >= 3;",
    query: "SELECT id FROM t ORDER BY id",
  },
  {
    id: "delete-008",
    setup: baseSetup + "\nDELETE FROM t WHERE id < 2;",
    query: "SELECT id FROM t ORDER BY id",
  },
  {
    id: "delete-009",
    setup: baseSetup + "\nDELETE FROM t WHERE id = 99;",
    query: "SELECT COUNT(*) FROM t",
  },
  {
    id: "delete-010",
    setup:
      "CREATE TABLE t (id INTEGER);\nINSERT INTO t VALUES (1);\nDELETE FROM t WHERE id = 1;",
    query: "SELECT id FROM t",
  },
];

for (let i = 11; i <= 35; i++) {
  const n = String(i).padStart(3, "0");
  const target = ((i - 11) % 4) + 1;
  valid.push({
    id: `delete-${n}`,
    setup: baseSetup + `\nDELETE FROM t WHERE id = ${target};`,
    query: "SELECT id FROM t ORDER BY id",
  });
}

const invalid = [
  { id: "delete-090", sql: "DELETE FROM missing;", invalid: true },
  {
    id: "delete-091",
    sql: "CREATE TABLE t (a INTEGER); DELETE t WHERE a = 1;",
    invalid: true,
  },
  {
    id: "delete-092",
    sql: "CREATE TABLE t (a INTEGER); DELETE FROM t WERE a = 1;",
    invalid: true,
  },
  {
    id: "delete-093",
    sql: "CREATE TABLE t (a INTEGER); DELETE FROM;",
    invalid: true,
  },
];

export default {
  section: "Delete",
  cases: [...valid, ...invalid],
};
