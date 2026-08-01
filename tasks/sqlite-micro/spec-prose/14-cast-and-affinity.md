CAST ( expr AS type ) converts a value to a target type. Supported target type names are INTEGER, REAL, TEXT, NUMERIC, and NONE. CAST(NULL AS any) yields NULL. CAST of non-numeric text to INTEGER or REAL yields NULL when no numeric prefix exists.

Column declared types determine affinity, not rigid storage. INTEGER affinity prefers integer storage; REAL prefers floating point; TEXT prefers text; NUMERIC prefers numeric conversions; NONE applies no conversion preference. Values inserted with a different storage class remain storable; affinity affects comparisons, sorting, and some operations.

The typeof function returns the storage class name of its argument: integer, real, text, or null. Affinity influences numeric operations on column values: TEXT columns may cast to numbers for arithmetic; INTEGER columns may participate in concatenation by converting to text when used with ||.

Comparisons and ORDER BY apply affinity rules before comparing values. CAST overrides affinity for the duration of the expression. Unsupported cast targets such as BLOB or DATETIME are out of scope.

**Must reject**

- CAST missing the expression or AS clause
- CAST with no type name or with multiple type names
- CAST with an empty argument list
- Malformed CAST syntax such as a missing closing parenthesis
