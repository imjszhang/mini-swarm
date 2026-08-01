/**
 * SQLite storage classes must be tracked separately from JSON magnitude:
 * integer 7 and real 7.0 both serialize as JSON number 7, but typeof and
 * CAST(... AS TEXT) differ. Workers should keep values tagged until emit.
 */
export type StorageClass = "null" | "integer" | "real" | "text";

export type Value =
  | { type: "null" }
  | { type: "integer"; value: number }
  | { type: "real"; value: number }
  | { type: "text"; value: string };

export type Row = Value[];

export interface TableData {
  name: string;
  columns: { name: string; declaredType: string }[];
  rows: Row[];
}

export const NULL_VALUE: Value = { type: "null" };

export function integerValue(n: number): Value {
  return { type: "integer", value: n };
}

export function realValue(n: number): Value {
  return { type: "real", value: n };
}

export function textValue(s: string): Value {
  return { type: "text", value: s };
}

/** JSON cell for stdout (null | number | string). */
export function valueToJson(v: Value): null | number | string {
  if (v.type === "null") return null;
  if (v.type === "text") return v.value;
  return v.value;
}

export function rowsToJson(rows: Row[]): string {
  return JSON.stringify(rows.map((r) => r.map(valueToJson)));
}

/** CAST AS TEXT formatting that preserves real fractional form for exact integers. */
export function valueToText(v: Value): string {
  if (v.type === "null") return "";
  if (v.type === "text") return v.value;
  if (v.type === "integer") return String(v.value);
  // real: keep a decimal point for integral magnitudes (1 → "1.0")
  if (Number.isInteger(v.value)) return `${v.value}.0`;
  return String(v.value);
}
