const valid = [
  { id: "comparison-and-logical-operators-001", query: "SELECT 1 = 1" },
  { id: "comparison-and-logical-operators-002", query: "SELECT 1 = 0" },
  { id: "comparison-and-logical-operators-003", query: "SELECT 1 <> 0" },
  { id: "comparison-and-logical-operators-004", query: "SELECT 1 != 0" },
  { id: "comparison-and-logical-operators-005", query: "SELECT 3 < 5" },
  { id: "comparison-and-logical-operators-006", query: "SELECT 5 > 3" },
  { id: "comparison-and-logical-operators-007", query: "SELECT 3 <= 3" },
  { id: "comparison-and-logical-operators-008", query: "SELECT 4 >= 5" },
  { id: "comparison-and-logical-operators-009", query: "SELECT 1 AND 1" },
  { id: "comparison-and-logical-operators-010", query: "SELECT 1 AND 0" },
  { id: "comparison-and-logical-operators-011", query: "SELECT 0 OR 1" },
  { id: "comparison-and-logical-operators-012", query: "SELECT 0 OR 0" },
  { id: "comparison-and-logical-operators-013", query: "SELECT NOT 0" },
  { id: "comparison-and-logical-operators-014", query: "SELECT NOT 1" },
  { id: "comparison-and-logical-operators-015", query: "SELECT (1 = 1) AND (2 > 1)" },
  { id: "comparison-and-logical-operators-016", query: "SELECT (1 = 0) OR (3 = 3)" },
  { id: "comparison-and-logical-operators-017", query: "SELECT NOT (1 = 0)" },
  { id: "comparison-and-logical-operators-018", query: "SELECT 'a' = 'a'" },
  { id: "comparison-and-logical-operators-019", query: "SELECT 'a' <> 'b'" },
  { id: "comparison-and-logical-operators-020", query: "SELECT NULL = NULL" },
];

for (let i = 21; i <= 35; i++) {
  const n = String(i).padStart(3, "0");
  const x = i;
  const y = i + 5;
  valid.push({
    id: `comparison-and-logical-operators-${n}`,
    query: `SELECT ${x} < ${y}, ${x} > ${y}, ${x} <= ${y}, ${x} >= ${y}`,
  });
}

const invalid = [
  {
    id: "comparison-and-logical-operators-090",
    sql: "SELECT 1 =;",
    invalid: true,
  },
  {
    id: "comparison-and-logical-operators-091",
    sql: "SELECT 1 AND;",
    invalid: true,
  },
  {
    id: "comparison-and-logical-operators-092",
    sql: "SELECT NOT;",
    invalid: true,
  },
  {
    id: "comparison-and-logical-operators-093",
    sql: "SELECT 1 <>;",
    invalid: true,
  },
];

export default {
  section: "Comparison And Logical Operators",
  cases: [...valid, ...invalid],
};
