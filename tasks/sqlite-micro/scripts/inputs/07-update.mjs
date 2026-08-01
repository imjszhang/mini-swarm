const baseSetup =
  "CREATE TABLE t (id INTEGER, val INTEGER, tag TEXT);\nINSERT INTO t VALUES (1, 10, 'a');\nINSERT INTO t VALUES (2, 20, 'b');\nINSERT INTO t VALUES (3, 30, 'c');";

const valid = [
  {
    id: "update-001",
    setup: baseSetup + "\nUPDATE t SET val = 11 WHERE id = 1;",
    query: "SELECT id, val FROM t WHERE id = 1",
  },
  {
    id: "update-002",
    setup: baseSetup + "\nUPDATE t SET val = val + 5;",
    query: "SELECT id, val FROM t ORDER BY id",
  },
  {
    id: "update-003",
    setup: baseSetup + "\nUPDATE t SET tag = 'x' WHERE id = 2;",
    query: "SELECT id, tag FROM t ORDER BY id",
  },
  {
    id: "update-004",
    setup: baseSetup + "\nUPDATE t SET val = 0 WHERE id > 2;",
    query: "SELECT id, val FROM t ORDER BY id",
  },
  {
    id: "update-005",
    setup: baseSetup + "\nUPDATE t SET val = 99, tag = 'z' WHERE id = 3;",
    query: "SELECT id, val, tag FROM t WHERE id = 3",
  },
  {
    id: "update-006",
    setup: baseSetup + "\nUPDATE t SET val = NULL WHERE id = 1;",
    query: "SELECT id, val FROM t WHERE id = 1",
  },
  {
    id: "update-007",
    setup: baseSetup + "\nUPDATE t SET tag = 'new' WHERE val >= 20;",
    query: "SELECT id, tag FROM t ORDER BY id",
  },
  {
    id: "update-008",
    setup: baseSetup + "\nUPDATE t SET val = 1 WHERE id = 1 OR id = 2;",
    query: "SELECT id, val FROM t ORDER BY id",
  },
  {
    id: "update-009",
    setup: baseSetup + "\nUPDATE t SET val = 100;",
    query: "SELECT COUNT(*) FROM t WHERE val = 100",
  },
  {
    id: "update-010",
    setup: baseSetup + "\nUPDATE t SET val = val * 2 WHERE id = 2;",
    query: "SELECT val FROM t WHERE id = 2",
  },
];

for (let i = 11; i <= 35; i++) {
  const n = String(i).padStart(3, "0");
  const newVal = i * 3;
  valid.push({
    id: `update-${n}`,
    setup: baseSetup + `\nUPDATE t SET val = ${newVal} WHERE id = ${((i - 11) % 3) + 1};`,
    query: "SELECT id, val FROM t ORDER BY id",
  });
}

const invalid = [
  {
    id: "update-090",
    sql: "UPDATE missing SET a = 1;",
    invalid: true,
  },
  {
    id: "update-091",
    sql: "CREATE TABLE t (a INTEGER); UPDATE t SET b = 1;",
    invalid: true,
  },
  {
    id: "update-092",
    sql: "CREATE TABLE t (a INTEGER); UPDATE t SET a =;",
    invalid: true,
  },
  {
    id: "update-093",
    sql: "CREATE TABLE t (a INTEGER); UPDAT t SET a = 1;",
    invalid: true,
  },
];

export default {
  section: "Update",
  cases: [...valid, ...invalid],
};
