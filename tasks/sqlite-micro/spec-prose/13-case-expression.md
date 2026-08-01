CASE expressions select among alternative result values. Two forms exist. Searched CASE: CASE WHEN condition THEN result [ WHEN ... ] [ ELSE result ] END. Simple CASE: CASE base WHEN value THEN result [ WHEN ... ] [ ELSE result ] END.

Conditions in searched form use the same three-valued boolean rules as WHERE. Simple form compares base to each WHEN value for equality with standard NULL rules: if base is NULL, no WHEN matches unless ELSE is present.

Evaluation stops at the first matching branch. If no branch matches and ELSE is omitted, the result is NULL. Nested CASE expressions are permitted. CASE may appear in SELECT lists, WHERE, aggregates, and UPDATE assignments.

WHEN and THEN are pairwise required. ELSE is optional. END must terminate every CASE. All result expressions within one CASE should be type-compatible; SQLite returns the value of the chosen branch without requiring a common declared type.

CASE does not short-circuit side effects because this subset has none. Subqueries in CASE are out of scope.

**Must reject**

- CASE without END
- WHEN without THEN or THEN without an expression
- ELSE without a result expression
- Searched CASE with WHEN immediately followed by THEN but missing a condition expression
