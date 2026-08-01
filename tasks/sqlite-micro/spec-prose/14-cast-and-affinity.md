CAST ( expr AS type ) converts a value to a target type. Supported target type names are INTEGER, REAL, TEXT, NUMERIC, and NONE. CAST(NULL AS any) yields NULL. CAST of non-numeric text (no leading numeric parse) to INTEGER yields the integer value 0, not NULL; CAST of such text to REAL yields 0.0. CAST of a real to TEXT uses a textual form that preserves a fractional part when the value is an exact integer real (for example 1.0 becomes the text "1.0").

Column declared types determine affinity applied on INSERT/UPDATE, not a rigid runtime type. INTEGER affinity converts an inserted value to integer storage only when the value is an integer or a text/real that is a pure integer literal for the whole string (for example '42' becomes integer 42). If the text has a fractional part ('7.9') or is non-numeric ('abc'), the original storage class is retained — REAL or TEXT respectively — even though the column was declared INTEGER. REAL affinity converts integer-looking values to real storage (typeof reports real even when the numeric magnitude is integral). TEXT affinity prefers text storage. NUMERIC prefers lossless numeric conversion. NONE applies no conversion preference.

The typeof function returns the storage class name of its argument: integer, real, text, or null. Because JSON numbers alone cannot distinguish integer 7 from real 7.0, the engine must track storage class separately from the numeric magnitude. Affinity influences numeric operations on column values: TEXT columns may cast to numbers for arithmetic; INTEGER columns may participate in concatenation by converting to text when used with ||.

Comparisons and ORDER BY apply affinity rules before comparing values. CAST overrides affinity for the duration of the expression. Unsupported cast targets such as BLOB or DATETIME are out of scope.

**Must reject**

- CAST missing the expression or AS clause
- CAST with no type name or with multiple type names
- CAST with an empty argument list
- Malformed CAST syntax such as a missing closing parenthesis
