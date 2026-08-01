const valid = [
  { id: "arithmetic-operators-001", query: "SELECT 1 + 2" },
  { id: "arithmetic-operators-002", query: "SELECT 10 - 3" },
  { id: "arithmetic-operators-003", query: "SELECT 4 * 5" },
  { id: "arithmetic-operators-004", query: "SELECT 20 / 4" },
  { id: "arithmetic-operators-005", query: "SELECT 17 % 5" },
  { id: "arithmetic-operators-006", query: "SELECT 7 / 2" },
  { id: "arithmetic-operators-007", query: "SELECT -7 / 2" },
  { id: "arithmetic-operators-008", query: "SELECT 7 / 0" },
  { id: "arithmetic-operators-009", query: "SELECT 7 % 0" },
  { id: "arithmetic-operators-010", query: "SELECT -10 % 3" },
  { id: "arithmetic-operators-011", query: "SELECT 10 % -3" },
  { id: "arithmetic-operators-012", query: "SELECT -10 % -3" },
  { id: "arithmetic-operators-013", query: "SELECT 2 + 3 * 4" },
  { id: "arithmetic-operators-014", query: "SELECT (2 + 3) * 4" },
  { id: "arithmetic-operators-015", query: "SELECT 100 - 50 - 25" },
  { id: "arithmetic-operators-016", query: "SELECT 0 + 0" },
  { id: "arithmetic-operators-017", query: "SELECT 1 * 0" },
  { id: "arithmetic-operators-018", query: "SELECT 0 / 5" },
  { id: "arithmetic-operators-019", query: "SELECT 5 % 1" },
  { id: "arithmetic-operators-020", query: "SELECT 5 % 5" },
];

for (let i = 21; i <= 35; i++) {
  const n = String(i).padStart(3, "0");
  const a = i;
  const b = (i % 7) + 1;
  valid.push({
    id: `arithmetic-operators-${n}`,
    query: `SELECT ${a} + ${b}, ${a} - ${b}, ${a} * ${b}, ${a} / ${b}, ${a} % ${b}`,
  });
}

const invalid = [
  { id: "arithmetic-operators-090", sql: "SELECT 1 +;", invalid: true },
  { id: "arithmetic-operators-091", sql: "SELECT 1 %;", invalid: true },
  { id: "arithmetic-operators-092", sql: "SELECT * 2;", invalid: true },
  { id: "arithmetic-operators-093", sql: "SELECT 1 +* 2;", invalid: true },
];

export default {
  section: "Arithmetic Operators",
  cases: [...valid, ...invalid],
};
