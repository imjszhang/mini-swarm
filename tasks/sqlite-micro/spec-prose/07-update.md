UPDATE modifies existing rows in a single table. Syntax is UPDATE table SET col = expr [ , ... ] [ WHERE predicate ]. Each assignment sets one column to the value of its expression for every row that satisfies the optional WHERE clause. Without WHERE, all rows are updated.

The SET clause must contain at least one assignment. Column names must exist on the target table. Expression evaluation uses the current row's values before any assignments in the same statement are applied to other columns of that row, matching SQLite row-update semantics for simple assignments.

UPDATE succeeds with no result rows. NULL may be assigned explicitly. Affinity rules apply to stored results as with INSERT. Triggers, RETURNING, and multi-table UPDATE are out of scope.

WHERE follows the same three-valued logic as SELECT: only rows with a true predicate are modified. Unknown columns in SET or WHERE are errors. Subqueries on the right-hand side of assignments are not supported.

Multiple columns may be updated in one statement; assignments are evaluated using pre-update row values, then written together per row.

**Must reject**

- UPDATE on a table that does not exist
- Unknown column names in SET or WHERE
- Empty SET clause or missing assignment expressions
- Trailing comma or syntax errors in UPDATE
- Any JOIN, FROM clause, or subquery form of UPDATE
