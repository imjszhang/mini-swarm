DELETE removes rows from a single table. Syntax is DELETE FROM table [ WHERE predicate ]. Rows for which the WHERE predicate evaluates to true are removed; false or NULL skips deletion for that row. Omitting WHERE deletes every row in the table while leaving the table definition intact.

DELETE succeeds with no result rows. The table continues to exist with zero rows when all rows are deleted. TRUNCATE, DELETE with JOIN, and DELETE with LIMIT are out of scope.

WHERE uses the same expression grammar and three-valued logic as SELECT and UPDATE. Unknown column references in WHERE are errors. Foreign-key cascade and trigger side effects are not modeled.

After deletion, remaining rows keep their implicit rowid ordering for subsequent SELECT without ORDER BY only as an implementation detail; callers should not rely on rowid stability across deletes except where ORDER BY rowid is explicitly used if supported.

Multiple DELETE statements in one script each apply to the current table state left by prior statements in the same session.

**Must reject**

- DELETE FROM a table that does not exist
- Unknown column names in WHERE
- Malformed DELETE syntax such as missing table name
- DELETE with JOIN, USING, or LIMIT clauses
- Syntax errors in the WHERE predicate
