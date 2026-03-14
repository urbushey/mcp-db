export interface ColumnDef {
  name: string;
  type: "text" | "integer" | "real" | "boolean";
  required?: boolean;
  primaryKey?: boolean;
}

export interface TableSchema {
  name: string;
  columns: ColumnDef[];
}

export interface QueryFilter {
  column: string;
  operator: "=" | "!=" | ">" | "<" | ">=" | "<=" | "like";
  value: string | number | boolean;
}

export interface QueryOptions {
  filters?: QueryFilter[];
  orderBy?: { column: string; direction: "asc" | "desc" };
  limit?: number;
}

export interface IDbAdapter {
  // Schema
  createTable(schema: TableSchema): Promise<void>;
  getTables(): Promise<TableSchema[]>;
  tableExists(name: string): Promise<boolean>;

  // Records
  insert(table: string, record: Record<string, unknown>): Promise<{ id: number }>;
  query(table: string, options: QueryOptions): Promise<Record<string, unknown>[]>;
  update(table: string, id: number, record: Partial<Record<string, unknown>>): Promise<void>;
  delete(table: string, id: number): Promise<void>;
  count(table: string, filters?: QueryFilter[]): Promise<number>;

  // Raw SQL (SELECT/WITH only)
  execute(sql: string, params?: (string | number | boolean)[]): Promise<Record<string, unknown>[]>;
}
