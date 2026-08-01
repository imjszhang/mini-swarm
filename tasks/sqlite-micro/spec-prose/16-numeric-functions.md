Numeric functions support INTEGER and REAL operands with NULL propagation. abs(x) returns absolute value. round(x) rounds to nearest integer; round(x, n) rounds to n digits after the decimal point. Scalar min(x, y) and max(x, y) return the lesser or greater value after comparison.

typeof(x) returns the storage class name: integer, real, text, or null. It accepts exactly one argument. A literal or column value stored as real keeps the real storage class even when its magnitude is an exact integer (typeof(0.0) is real, not integer).

These scalar functions differ from aggregate MIN and MAX covered elsewhere: the two-argument min and max are scalar comparisons, not aggregates over rows. Nested calls such as round(max(a, b)) are valid.

Scalar min and max propagate NULL: if any argument is NULL, the result is NULL (they do not skip NULLs to return the other operand). abs and round likewise yield NULL when their primary numeric argument is NULL.

round with two arguments requires exactly two; round with one requires exactly one. abs requires exactly one. Calling aggregates with zero arguments is invalid in this subset.

Trigonometric, logarithmic, and random functions are out of scope.

**Must reject**

- abs, round, or typeof called with no arguments
- round called with more than two arguments
- Scalar min or max called with zero or one arguments
- Aggregate max or min invoked with empty parentheses where an argument is required
