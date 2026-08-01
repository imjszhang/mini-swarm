Comparison operators are =, ==, !=, <>, <, >, <=, and >=. They compare numeric values numerically and text values by binary collation order after affinity conversion. Two NULL operands compare unequal with = and equal with IS handled elsewhere; here, =, <>, and ordering operators applied to NULL yield NULL (unknown), not true or false.

Logical operators AND, OR, and NOT implement SQLite three-valued logic. AND returns false if either side is false, true if both are true, otherwise NULL. OR returns true if either side is true, false if both are false, otherwise NULL. NOT maps true to false, false to true, and NULL to NULL.

In SELECT projections, comparison and logical results are returned as integer 1 for true and 0 for false; NULL remains NULL. In WHERE filters, only true passes; false and NULL exclude the row.

Operator precedence from tightest to loosest: NOT, comparisons, AND, OR. Parentheses override. The != token is synonymous with <>.

Chained comparisons such as BETWEEN are covered separately. Subqueries, EXISTS, and JOIN predicates are out of scope.

**Must reject**

- Comparison operators missing a right-hand operand
- AND or OR with a missing operand
- NOT without a following expression
- Malformed operator tokens or dangling operators at end of expression
