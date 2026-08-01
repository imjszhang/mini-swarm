WHERE filters rows from a single-table SELECT, UPDATE, or DELETE. Only rows for which the predicate evaluates to true are kept; false removes the row; NULL treats the row as not matching. This three-valued interpretation applies uniformly: a NULL condition does not pass the filter.

Predicates may use comparison operators, logical AND/OR/NOT, parentheses, IS NULL, IS NOT NULL, BETWEEN, IN, and LIKE as defined in later sections. Column references must exist on the target table. WHERE is optional; omitting it applies the statement to all rows.

Operator precedence follows SQLite: NOT binds tightest, then concatenation, then multiplicative arithmetic, additive arithmetic, comparisons, AND, then OR. Use parentheses to override.

WHERE cannot reference aggregate results; aggregates without GROUP BY appear only in select lists of separate queries. Subqueries in predicates, EXISTS, and ANY are out of scope.

For UPDATE and DELETE, WHERE restricts affected rows; without WHERE, all rows of the table are candidates. Combined with expressions that propagate NULL, filters such as col = NULL never match rows; use IS NULL instead.

**Must reject**

- Unknown column names in the WHERE clause
- Incomplete predicates such as a trailing operator or missing BETWEEN bounds
- Subqueries, EXISTS, or JOIN syntax inside WHERE
- Syntax errors in the predicate expression
