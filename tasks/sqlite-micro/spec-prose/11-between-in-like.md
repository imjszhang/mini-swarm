BETWEEN expr AND expr tests inclusive range membership after pairwise comparison with three-valued logic. NOT BETWEEN negates the result. Both bounds are required. BETWEEN works on numeric and text operands using the same ordering rules as < and >.

IN ( value , ... ) tests equality against a parenthesized list of expressions. NOT IN negates the result. An empty IN list always yields false for IN and true for NOT IN. NULL on either side of a tested equality inside IN follows standard NULL comparison rules; a row matches IN only if at least one non-NULL equal comparison succeeds.

LIKE pattern matches use % as a sequence wildcard and _ as a single-character wildcard. NOT LIKE negates the match. By default, LIKE is case-insensitive for ASCII letters in SQLite; patterns and operands are compared accordingly unless an ESCAPE clause is present. ESCAPE defines an escape character before literal % or _ in the pattern.

All three forms are valid in WHERE and in general boolean contexts. Subquery forms such as IN ( SELECT ... ) are out of scope. GLOB and REGEXP are not supported.

**Must reject**

- BETWEEN with only one bound or missing AND
- IN without a parenthesized value list
- LIKE without a pattern operand
- Trailing commas inside IN lists or incomplete NOT IN syntax
