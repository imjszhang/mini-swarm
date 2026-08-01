The engine rejects invalid SQL with a non-zero exit status and no successful result output. This section consolidates all rejection categories for the Tier 1 in-memory single-table subset. JOIN, GROUP BY, subqueries, constraints, views, indexes, transactions, and PRAGMA are out of scope and must be rejected if present.

Syntax errors cover misspelled keywords, missing required clauses, incomplete expressions, empty parenthesized lists where values are required, and trailing operators. Examples include SELECT without a projection, INSERT without VALUES, UPDATE without SET assignments, and malformed CASE or CAST syntax.

Unknown table errors occur when FROM, INSERT INTO, UPDATE, or DELETE references a table name not created in the current session. Unknown column errors occur when a select list, WHERE, SET, or INSERT column list names a column not on the referenced table.

Duplicate CREATE TABLE for an existing name is rejected; the first definition remains and the second fails. INSERT value and column arity mismatches are rejected: VALUES count must match column count for the chosen INSERT form, and explicit column lists must pair one value per listed column.

Wrong function arity is rejected: each built-in requires its defined argument count; too few or too many arguments fail at parse or validate time. Unknown function names are treated as errors.

**Must reject**

- Syntax errors: malformed statements, misspelled keywords, incomplete clauses
- Unknown table references in any statement
- Unknown column references in expressions or assignment lists
- Duplicate CREATE TABLE for the same table name
- INSERT column/value count mismatches for either INSERT form
- Built-in functions called with incorrect argument counts
