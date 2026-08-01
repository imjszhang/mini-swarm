Binary arithmetic operators are +, -, *, /, and %. Unary minus negates a numeric operand. Operands may be integer literals, real literals, parenthesized expressions, or column values subject to numeric affinity conversion. NULL operands propagate: any arithmetic expression involving NULL evaluates to NULL unless the whole expression is unreachable.

Addition, subtraction, and multiplication use integer arithmetic when both operands are integers; if either operand is REAL, the operation is performed in floating point and the result is REAL. The division operator / truncates toward zero when both operands are integers, yielding an integer result. When either operand is REAL, / performs floating-point division and yields REAL.

The modulo operator % returns the remainder after integer division; the sign of the result follows the dividend. Division or modulo by zero does not error; it yields NULL.

Operator precedence is unary minus, then * / %, then + -, left-associative within each level. Parentheses override precedence. String operands in arithmetic contexts are cast to numeric values when possible; non-numeric strings become zero or NULL per SQLite conversion rules.

This section covers SELECT expressions only. JOIN and subqueries are out of scope.

**Must reject**

- Binary operators missing a right-hand operand
- Unary * used as a standalone operator where a factor is required
- Adjacent operators with no operand between them
- Any syntax error in an arithmetic expression
