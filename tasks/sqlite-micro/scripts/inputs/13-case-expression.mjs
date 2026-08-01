const setup = `CREATE TABLE t (id INTEGER, grade TEXT, score INTEGER, kind TEXT);
INSERT INTO t VALUES (1, 'A', 95, 'exam');
INSERT INTO t VALUES (2, 'B', 82, 'quiz');
INSERT INTO t VALUES (3, 'C', 71, 'exam');
INSERT INTO t VALUES (4, 'D', 60, 'quiz');
INSERT INTO t VALUES (5, 'F', 45, 'exam');`;

const valid = [
  { id: "case-expression-001", setup, query: "SELECT id, CASE WHEN score >= 90 THEN 'high' ELSE 'other' END AS band FROM t ORDER BY id" },
  { id: "case-expression-002", setup, query: "SELECT id, CASE WHEN score >= 90 THEN 'A' WHEN score >= 80 THEN 'B' WHEN score >= 70 THEN 'C' ELSE 'low' END AS tier FROM t ORDER BY id" },
  { id: "case-expression-003", setup, query: "SELECT id, CASE grade WHEN 'A' THEN 4 WHEN 'B' THEN 3 WHEN 'C' THEN 2 ELSE 1 END AS pts FROM t ORDER BY id" },
  { id: "case-expression-004", setup, query: "SELECT id, CASE kind WHEN 'exam' THEN score ELSE score - 5 END AS adj FROM t ORDER BY id" },
  { id: "case-expression-005", setup, query: "SELECT id, CASE WHEN score IS NULL THEN 0 ELSE score END AS s FROM t ORDER BY id" },
  { id: "case-expression-006", setup, query: "SELECT CASE WHEN 1 = 1 THEN 'yes' ELSE 'no' END AS v" },
  { id: "case-expression-007", setup, query: "SELECT CASE WHEN 1 = 0 THEN 1 ELSE 2 END AS v" },
  { id: "case-expression-008", setup, query: "SELECT CASE 2 WHEN 1 THEN 'one' WHEN 2 THEN 'two' ELSE 'other' END AS v" },
  { id: "case-expression-009", setup, query: "SELECT CASE 'x' WHEN 'x' THEN 1 WHEN 'y' THEN 2 END AS v" },
  { id: "case-expression-010", setup, query: "SELECT id, CASE WHEN score > 80 THEN CASE WHEN kind = 'exam' THEN 'honor' ELSE 'good' END ELSE 'ok' END AS label FROM t ORDER BY id" },
  { id: "case-expression-011", setup, query: "SELECT id, CASE WHEN id % 2 = 0 THEN 'even' ELSE 'odd' END AS parity FROM t ORDER BY id" },
  { id: "case-expression-012", setup, query: "SELECT id, CASE WHEN grade IN ('A', 'B') THEN 1 ELSE 0 END AS top FROM t ORDER BY id" },
  { id: "case-expression-013", setup, query: "SELECT id, CASE WHEN score BETWEEN 70 AND 89 THEN 'pass' ELSE 'fail' END AS status FROM t ORDER BY id" },
  { id: "case-expression-014", setup, query: "SELECT COUNT(*) AS n FROM t WHERE CASE WHEN score >= 70 THEN 1 ELSE 0 END = 1" },
  { id: "case-expression-015", setup, query: "SELECT id, CASE score WHEN 95 THEN 100 WHEN 82 THEN 90 ELSE score END AS curved FROM t ORDER BY id" },
  { id: "case-expression-016", setup, query: "SELECT id, CASE WHEN grade = 'A' THEN score + 5 WHEN grade = 'F' THEN score - 5 ELSE score END AS adj FROM t ORDER BY id" },
  { id: "case-expression-017", setup, query: "SELECT id, CASE WHEN kind = 'exam' AND score >= 90 THEN 'star' ELSE kind END AS tag FROM t ORDER BY id" },
  { id: "case-expression-018", setup, query: "SELECT id, CASE WHEN NOT (score < 70) THEN 'pass' ELSE 'fail' END AS pf FROM t ORDER BY id" },
  { id: "case-expression-019", setup, query: "SELECT id, CASE WHEN score IS NULL THEN NULL ELSE score * 2 END AS d FROM t ORDER BY id" },
  { id: "case-expression-020", setup, query: "SELECT id, CASE WHEN grade LIKE 'A%' THEN 1 ELSE 0 END AS is_a FROM t ORDER BY id" },
  { id: "case-expression-021", setup, query: "SELECT SUM(CASE WHEN score >= 70 THEN score ELSE 0 END) AS pass_sum FROM t" },
  { id: "case-expression-022", setup, query: "SELECT AVG(CASE WHEN kind = 'exam' THEN score END) AS exam_avg FROM t" },
  { id: "case-expression-023", setup, query: "SELECT MIN(CASE WHEN grade = 'A' THEN score END) AS min_a FROM t" },
  { id: "case-expression-024", setup, query: "SELECT MAX(CASE WHEN grade = 'F' THEN score END) AS max_f FROM t" },
  { id: "case-expression-025", setup, query: "SELECT id, CASE WHEN id < 3 THEN CASE WHEN score > 80 THEN 'early_high' ELSE 'early_low' END ELSE 'late' END AS seg FROM t ORDER BY id" },
  { id: "case-expression-026", setup, query: "SELECT id, CASE WHEN score >= 90 THEN 'A' WHEN score >= 80 THEN 'B' WHEN score >= 70 THEN 'C' WHEN score >= 60 THEN 'D' ELSE 'F' END AS calc FROM t ORDER BY id" },
  { id: "case-expression-027", setup, query: "SELECT id, CASE kind WHEN 'exam' THEN 1 WHEN 'quiz' THEN 2 ELSE 3 END AS k FROM t ORDER BY id" },
  { id: "case-expression-028", setup, query: "SELECT id, CASE WHEN score > 50 THEN score - 50 ELSE 0 END AS extra FROM t ORDER BY id" },
  { id: "case-expression-029", setup, query: "SELECT id, CASE WHEN grade = 'B' OR grade = 'C' THEN 'mid' ELSE 'extreme' END AS bucket FROM t ORDER BY id" },
  { id: "case-expression-030", setup, query: "SELECT id, CASE WHEN score = 95 THEN 'top' WHEN score = 45 THEN 'bottom' ELSE 'mid' END AS pole FROM t ORDER BY id" },
  { id: "case-expression-031", setup, query: "SELECT CASE WHEN NULL THEN 1 ELSE 2 END AS v" },
  { id: "case-expression-032", setup, query: "SELECT id, CASE 0 WHEN score THEN 1 ELSE 0 END AS z FROM t ORDER BY id" },
  { id: "case-expression-033", setup, query: "SELECT id, CASE WHEN score >= 70 THEN 1 ELSE 0 END + CASE WHEN kind = 'exam' THEN 1 ELSE 0 END AS flags FROM t ORDER BY id" },
  { id: "case-expression-034", setup, query: "SELECT COUNT(CASE WHEN grade = 'A' THEN 1 END) AS a_count FROM t" },
  { id: "case-expression-035", setup, query: "SELECT id, CASE WHEN score >= 80 THEN 'high' END AS maybe FROM t ORDER BY id" },
];

const invalid = [
  { id: "case-expression-090", sql: "SELECT CASE END;", invalid: true },
  { id: "case-expression-091", sql: "SELECT CASE 1 WHEN 2 THEN 3 ELSE;", invalid: true },
  { id: "case-expression-092", sql: "SELECT CASE WHEN 1 = 1 THEN 1 WHEN 2 THEN 2;", invalid: true },
  { id: "case-expression-093", sql: "SELECT CASE WHEN THEN 1 END;", invalid: true },
];

export default {
  section: "Case Expression",
  cases: [...valid, ...invalid],
};
