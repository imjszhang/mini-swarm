Aggregate functions summarize all rows of a single-table query without GROUP BY. Supported aggregates are COUNT(*), COUNT(expr), SUM(expr), AVG(expr), MIN(expr), and MAX(expr). A SELECT containing any aggregate without GROUP BY returns exactly one row computed over the full filtered row set.

COUNT(*) counts rows including those where individual columns are NULL. COUNT(expr) counts rows where expr is not NULL. SUM and AVG ignore NULL inputs; SUM of no non-NULL values is NULL; AVG of no non-NULL values is NULL. MIN and MAX ignore NULL; on an empty table or all-NULL column, MIN and MAX return NULL.

Non-aggregate columns may not appear alongside aggregates in the same SELECT unless they are functionally determined, which this subset does not support; therefore valid queries use only aggregates, literals, and expressions derived from aggregates in the select list when aggregating.

WHERE may filter rows before aggregation. DISTINCT inside aggregates is covered separately. GROUP BY, HAVING, window functions, and filtered aggregates are out of scope.

**Must reject**

- SUM, AVG, MIN, or MAX called with empty parentheses
- COUNT used without parentheses
- COUNT with more than one argument
- SELECT lists mixing bare column references with aggregates on multi-row tables
