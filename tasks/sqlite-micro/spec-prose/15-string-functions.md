String functions operate on TEXT values. Operands are cast to text when needed. NULL arguments generally propagate NULL except where noted for concatenation.

Supported functions: length(x) returns character count; lower(x) and upper(x) change ASCII letter case; substr(x, start, len) and substring alias extract a substring with SQLite indexing rules including negative start; trim(x), ltrim(x), rtrim(x) remove whitespace, and trim(x, chars) removes leading and trailing characters from the optional second argument; replace(x, from, to) substitutes all occurrences.

The || operator concatenates strings. If either operand is NULL and the other is not, the non-NULL value is returned; if both are NULL, the result is NULL. Non-text operands are cast to text before concatenation.

Functions require exact arity: length, lower, upper, ltrim, and rtrim take one argument; substr takes two or three; replace takes three; trim takes one or two. Unknown functions are errors.

Regular expressions, unicode-aware case mapping beyond SQLite defaults, and BLOB text conversions are out of scope.

**Must reject**

- String functions called with too few or too many arguments
- replace or substr invoked without required operands
- trim with more than two arguments
- Unknown function names or missing parentheses
