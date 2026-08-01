ORDER BY sorts result rows from SELECT. Syntax is ORDER BY sort_key [ ASC | DESC ] [ , ... ]. ASC is the default. Sort keys may be column names, select-list aliases, ordinal positions counting from one in the select list, or general expressions. Multiple keys sort lexicographically left to right.

NULLs sort together. Under the default ASC sort, NULL sorts before every non-NULL value; under DESC, NULL sorts after every non-NULL value. ORDER BY applies after WHERE and DISTINCT deduplication but before LIMIT/OFFSET trimming when all are present.

LIMIT n retains at most n rows after sorting; OFFSET m skips the first m rows of the sorted stream. Non-negative integer literals are expected for LIMIT and OFFSET. LIMIT 0 yields an empty result. OFFSET without LIMIT is allowed.

ORDER BY is not supported on UPDATE or DELETE in this subset. Indexed access paths and collating sequences beyond default binary/affinity comparison are out of scope.

When ORDER BY references a column not in the select list, sorting still occurs on that column's values. Ordinal positions must refer to valid select-list indices.

**Must reject**

- ORDER BY referencing unknown columns on the queried table when a column name is required
- Malformed ORDER BY with missing sort keys or dangling ASC/DESC
- Invalid LIMIT/OFFSET syntax such as missing numeric operands
- ORDER BY combined with unsupported constructs like JOIN
