This experiment implements a Tier 1 SQLite-compatible subset for an in-memory database. Each query references at most one table; JOIN, subqueries, GROUP BY, constraints, indexes, and triggers are out of scope. Statements are case-insensitive for keywords unless quoted.

Integer literals are signed decimal sequences without a fractional part. Real literals contain a decimal point. Scientific notation is not supported. String literals are single-quoted; an embedded apostrophe is escaped by doubling it. Backslash escape sequences inside strings are not interpreted unless explicitly documented elsewhere. The NULL literal represents a missing value distinct from zero or an empty string.

Double-quoted tokens are identifier quotes, not string literals. They may contain spaces and reserved words such as select or from. Unquoted identifiers consist of letters, digits, and underscores and must not start with a digit. Identifiers are matched case-insensitively unless quoted.

SELECT may list multiple result columns separated by commas. Each column expression may carry an optional AS alias; unquoted aliases follow identifier rules, quoted aliases use double quotes. SELECT without FROM is valid and evaluates expressions only.

Unary minus binds to numeric literals and parenthesized expressions. Parentheses override default precedence for nested expressions.

**Must reject**

- Unclosed single- or double-quoted literals
- Malformed numeric tokens such as multiple decimal points or a trailing exponent without digits
- Tokens that violate identifier formation rules where an identifier is required
