CREATE TABLE defines a new table in the in-memory catalog. Syntax is CREATE TABLE table_name ( column_name type_name , ... ). Supported declared type names are INTEGER, REAL, TEXT, NUMERIC, and NONE. Declared types guide affinity but do not enforce rigid storage classes at insert time. PRIMARY KEY, UNIQUE, NOT NULL, CHECK, FOREIGN KEY, and DEFAULT column constraints are out of scope and must not appear.

Each CREATE TABLE must name at least one column. Column names follow the same identifier rules as elsewhere. Multiple tables may exist in one session, but each query still reads or writes a single table. Creating a table with a name that already exists is an error; the engine does not replace or alter existing definitions.

CREATE TABLE succeeds with no result rows. Subsequent INSERT statements populate rows. An empty table is valid and yields zero rows on SELECT. Quoted table and column names are permitted when they collide with reserved words or contain spaces.

Type affinity for declared INTEGER columns prefers integer storage; REAL prefers floating point; TEXT prefers text; NUMERIC prefers numeric conversions; NONE imposes no conversion preference. These affinities affect comparisons and some casts but do not reject values of other storage classes at insert time.

**Must reject**

- CREATE TABLE without a table name or with an empty column list
- Malformed column lists or missing parentheses
- Duplicate CREATE TABLE for the same table name in one session
- Any constraint clause beyond a bare type name
