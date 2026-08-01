SELECT DISTINCT removes duplicate rows from the result set after evaluating the select list expressions but before ORDER BY and LIMIT unless otherwise specified. DISTINCT applies to the entire projection tuple: SELECT DISTINCT a, b deduplicates combined rows, not columns independently.

DISTINCT may prefix a select list with one or more expressions, including function calls and CASE results. SELECT DISTINCT * is valid on a single table. DISTINCT combines with WHERE to deduplicate filtered rows only.

COUNT(DISTINCT expr) counts unique non-NULL values of expr. Other aggregates with DISTINCT apply the aggregate after deduplicating input values. DISTINCT ON, GROUP BY, and window DISTINCT are out of scope.

ORDER BY may reference select-list columns, aliases, ordinals, or columns not shown in the select list when querying a single table. When ORDER BY references a column absent from the select list, sorting still uses that column's values. SELECT DISTINCT combined with ORDER BY uses the same NULL ordering as ORDER BY alone (NULL before non-NULL in ASC).

LIMIT and OFFSET apply after DISTINCT and ORDER BY. Joins and subqueries are out of scope.

**Must reject**

- DISTINCT without a select list
- Repeated DISTINCT keywords
- Trailing comma after the last select-list item
- DISTINCT combined with unsupported GROUP BY or JOIN syntax
