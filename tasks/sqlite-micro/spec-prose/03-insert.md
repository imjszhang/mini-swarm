INSERT adds one row to a table. Two forms are supported: INSERT INTO table VALUES ( expr , ... ) and INSERT INTO table ( col , ... ) VALUES ( expr , ... ). The number of value expressions must exactly match the number of target columns. For the VALUES-only form, the expression count must equal the table's column count in definition order.

When a column list is supplied, values are bound positionally to those columns in the order listed. Columns not named in the list receive NULL. NULL may be inserted explicitly into any column.

INSERT succeeds with no result rows. Values are stored according to SQLite dynamic typing; declared column affinity may coerce representations but does not reject mismatched literal types at insert time. String literals, integers, reals, and NULL are all valid value expressions.

Multiple value tuples in one INSERT statement are supported. INSERT OR REPLACE, UPSERT, and INSERT ... SELECT are out of scope.

**Must reject**

- INSERT into a table that does not exist
- Column/value count mismatch for either INSERT form
- References to column names not defined on the target table
- Missing VALUES clause, empty value list, or trailing comma in the value list
- Syntax errors in the INSERT statement
