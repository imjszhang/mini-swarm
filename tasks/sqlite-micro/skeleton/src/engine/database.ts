import type { TableData } from "../types.js";

export class Database {
  tables = new Map<string, TableData>();

  createTable(
    name: string,
    columns: { name: string; declaredType: string }[],
  ): void {
    const key = name.toLowerCase();
    this.tables.set(key, {
      name,
      columns: columns.map((col) => ({ ...col })),
      rows: [],
    });
  }

  getTable(name: string): TableData {
    const key = name.toLowerCase();
    const table = this.tables.get(key);
    if (!table) {
      throw new Error(`table not found: ${name}`);
    }
    return table;
  }
}
