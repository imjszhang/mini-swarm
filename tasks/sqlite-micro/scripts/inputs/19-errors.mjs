const syntax = [
  { id: "errors-001", sql: "SELEC 1;", invalid: true },
  { id: "errors-002", sql: "SELECT FROM t;", invalid: true },
  { id: "errors-003", sql: "SELECT * FORM t;", invalid: true },
  { id: "errors-004", sql: "CREATE TABEL t (a INTEGER);", invalid: true },
  { id: "errors-005", sql: "SELECT 1 WHERE;", invalid: true },
  { id: "errors-006", sql: "INSERT INTO t VALUES;", invalid: true },
  { id: "errors-007", sql: "UPDATE t SET;", invalid: true },
];

const unknownTable = [
  { id: "errors-008", sql: "SELECT a FROM missing_table;", invalid: true },
  { id: "errors-009", sql: "INSERT INTO missing_table VALUES (1);", invalid: true },
  { id: "errors-010", sql: "UPDATE missing_table SET a = 1;", invalid: true },
  { id: "errors-011", sql: "DELETE FROM missing_table;", invalid: true },
  { id: "errors-012", sql: "CREATE TABLE t (a INTEGER); SELECT * FROM other_table;", invalid: true },
];

const unknownCol = [
  { id: "errors-013", sql: "CREATE TABLE t (a INTEGER); SELECT nosuch FROM t;", invalid: true },
  { id: "errors-014", sql: "CREATE TABLE t (a INTEGER); SELECT a FROM t WHERE nosuch = 1;", invalid: true },
  { id: "errors-015", sql: "CREATE TABLE t (a INTEGER); UPDATE t SET nosuch = 1;", invalid: true },
  { id: "errors-016", sql: "CREATE TABLE t (a INTEGER); INSERT INTO t (nosuch) VALUES (1);", invalid: true },
  { id: "errors-017", sql: "CREATE TABLE t (a INTEGER, b TEXT); SELECT a, badcol FROM t;", invalid: true },
];

const dupCreateTable = [
  { id: "errors-018", sql: "CREATE TABLE t (a INTEGER); CREATE TABLE t (b TEXT);", invalid: true },
  { id: "errors-019", sql: "CREATE TABLE items (x INTEGER); CREATE TABLE items (y INTEGER);", invalid: true },
  { id: "errors-020", sql: "CREATE TABLE dup (a INTEGER); CREATE TABLE dup (a TEXT, b INTEGER);", invalid: true },
  { id: "errors-021", sql: "CREATE TABLE z (n INTEGER); CREATE TABLE z (n INTEGER);", invalid: true },
  { id: "errors-022", sql: "CREATE TABLE foo (id INTEGER); CREATE TABLE foo (id INTEGER, name TEXT);", invalid: true },
];

const insertArity = [
  { id: "errors-023", sql: "CREATE TABLE t (a INTEGER, b INTEGER); INSERT INTO t VALUES (1);", invalid: true },
  { id: "errors-024", sql: "CREATE TABLE t (a INTEGER, b INTEGER); INSERT INTO t VALUES (1);", invalid: true },
  { id: "errors-025", sql: "CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1, 2);", invalid: true },
  { id: "errors-026", sql: "CREATE TABLE t (a INTEGER, b INTEGER, c INTEGER); INSERT INTO t (a, b) VALUES (1, 2, 3);", invalid: true },
  { id: "errors-027", sql: "CREATE TABLE t (a INTEGER, b TEXT); INSERT INTO t (a, b) VALUES ('only');", invalid: true },
  { id: "errors-028", sql: "CREATE TABLE t (a INTEGER); INSERT INTO t (a) VALUES (1, 2);", invalid: true },
];

const badFunctionArity = [
  { id: "errors-029", sql: "SELECT length();", invalid: true },
  { id: "errors-030", sql: "SELECT abs();", invalid: true },
  { id: "errors-031", sql: "SELECT round();", invalid: true },
  { id: "errors-032", sql: "SELECT max();", invalid: true },
  { id: "errors-033", sql: "SELECT round(1, 2, 3);", invalid: true },
  { id: "errors-034", sql: "SELECT lower('a', 'b');", invalid: true },
  { id: "errors-035", sql: "SELECT replace('a');", invalid: true },
  { id: "errors-036", sql: "SELECT substr('abc');", invalid: true },
];

const extra = [
  { id: "errors-037", sql: "SELECT 1 +;", invalid: true },
  { id: "errors-038", sql: "CREATE TABLE t (a INTEGER); SELECT a FROM t WHERE a BETWEEN 1;", invalid: true },
  { id: "errors-039", sql: "CREATE TABLE t (a INTEGER); SELECT a FROM t WHERE a IN;", invalid: true },
  { id: "errors-040", sql: "SELECT CASE WHEN THEN 1 END;", invalid: true },
];

export default {
  section: "Errors",
  cases: [
    ...syntax,
    ...unknownTable,
    ...unknownCol,
    ...dupCreateTable,
    ...insertArity,
    ...badFunctionArity,
    ...extra,
  ],
};
