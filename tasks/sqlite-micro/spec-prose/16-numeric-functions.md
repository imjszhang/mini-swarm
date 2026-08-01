Numeric functions support INTEGER and REAL operands with NULL propagation. abs(x) returns absolute value. round(x) rounds to nearest integer; round(x, n) rounds to n digits after the decimal point. min(x, y) and max(x, y) return the lesser or greater numeric value after comparison.

typeof(x) returns the storage class name: integer, real, text, or null. It accepts exactly one argument.

These scalar functions differ from aggregate MIN and MAX covered elsewhere: the two-argument min and max are scalar comparisons, not aggregates over rows. Nested calls such as round(max(a, b)) are valid.

When any required numeric argument is NULL, the result is NULL unless both operands of min/max are evaluated and one is NULL, in which case SQLite returns the non-NULL operand for two-argument min/max.

round with two arguments requires exactly two; round with one requires exactly one. abs requires exactly one. Calling aggregates with zero arguments is invalid in this subset.

Trigonometric, logarithmic, and random functions are out of scope.

**Must reject**

- abs, round, or typeof called with no arguments
- round called with more than two arguments
- Scalar min or max called with zero or one arguments
- Aggregate max or min invoked with empty parentheses where an argument is required
