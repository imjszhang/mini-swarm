export type Value = null | number | string;
export type Row = Value[];
export interface TableData {
  name: string;
  columns: { name: string; declaredType: string }[];
  rows: Row[];
}
