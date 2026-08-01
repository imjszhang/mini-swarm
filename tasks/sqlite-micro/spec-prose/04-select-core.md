SELECT retrieves columns from a single table or evaluates a literal projection without FROM. The form is SELECT select_list FROM table_name. SELECT * expands to all columns in table definition order. Explicit lists may name columns, expressions, and function calls, each with an optional AS alias.

When FROM is omitted, the select list is evaluated once and returns one result row. When FROM names an existing table, one result row is produced per stored row unless filtered by WHERE. Unknown table or column names are errors resolved before execution.

Result column names default from the expression: bare column names keep their name, other expressions may use a supplied alias or an implementation-defined name. Quoted aliases preserve case and reserved words.

SELECT does not deduplicate rows unless DISTINCT is specified in a later section. There is no GROUP BY, HAVING, JOIN, UNION, or subquery support. Correlated references and table aliases in FROM are out of scope.

Expression columns may combine literals, column references, operators, and functions subject to their own sections. Ordering of rows without ORDER BY is not guaranteed but typically follows insertion order via implicit rowid.

**Must reject**

- SELECT with a malformed or empty select list
- FROM referencing a table that does not exist
- Column references not present on the named table
- SELECT * or column lists combined with unsupported clauses such as JOIN or GROUP BY
