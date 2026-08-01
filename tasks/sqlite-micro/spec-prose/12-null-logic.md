NULL represents a missing or unknown value. IS NULL and IS NOT NULL are the only reliable tests for nullity. Comparisons such as col = NULL or col <> NULL always yield NULL (unknown) and never filter rows in WHERE; use IS NULL or IS NOT NULL instead.

Three-valued logic governs all boolean combinations involving NULL. Arithmetic with NULL yields NULL. String concatenation with || treats NULL as empty string in SQLite, so NULL || 'x' yields 'x' and 'x' || NULL yields 'x'; both NULL operands yield NULL.

Aggregates ignore NULL inputs except COUNT(*) which counts rows. CASE, CAST, and function calls each follow their own NULL propagation rules in later sections.

IS NULL binds as a postfix operator to its left expression. IS NOT NULL is a single operator. NULL literal may appear in INSERT values, SELECT projections, and CASE results.

Testing nullity in WHERE with IS NULL includes rows where the column is missing; IS NOT NULL excludes them. Logical combinations of nullity tests follow standard AND/OR rules.

**Must reject**

- IS or IS NOT without NULL
- IS NOT without NULL following it
- Duplicate NULL tokens used as consecutive expressions
- Any attempt to use = NULL or <> NULL where IS forms are required for nullity tests in normative examples
