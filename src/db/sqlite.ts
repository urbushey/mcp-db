import { Database } from "bun:sqlite";
import type { IDbAdapter, TableSchema, QueryFilter, QueryOptions } from "./adapter.ts";

function sqliteType(type: string): string {
  switch (type) {
    case "integer": return "INTEGER";
    case "real": return "REAL";
    case "boolean": return "INTEGER"; // SQLite stores booleans as 0/1
    default: return "TEXT";
  }
}

export class SqliteAdapter implements IDbAdapter {
  private db: Database;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
  }

  async createTable(schema: TableSchema): Promise<void> {
    const cols = schema.columns.map((col) => {
      const parts: string[] = [col.name, sqliteType(col.type)];
      if (col.primaryKey) parts.push("PRIMARY KEY AUTOINCREMENT");
      if (col.required && !col.primaryKey) parts.push("NOT NULL");
      return parts.join(" ");
    });

    // Always ensure an id column exists as primary key
    const hasPk = schema.columns.some((c) => c.primaryKey);
    const colDefs = hasPk ? cols : ["id INTEGER PRIMARY KEY AUTOINCREMENT", ...cols];

    const sql = `CREATE TABLE IF NOT EXISTS "${schema.name}" (${colDefs.join(", ")})`;
    this.db.run(sql);
  }

  async getTables(): Promise<TableSchema[]> {
    const tables = this.db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];

    return tables.map((t) => {
      const cols = this.db
        .query(`PRAGMA table_info("${t.name}")`)
        .all() as { name: string; type: string; notnull: number; pk: number }[];

      return {
        name: t.name,
        columns: cols.map((c) => ({
          name: c.name,
          type: this.mapSqliteType(c.type),
          required: c.notnull === 1 || c.pk === 1,
          primaryKey: c.pk === 1,
        })),
      };
    });
  }

  async tableExists(name: string): Promise<boolean> {
    const row = this.db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(name);
    return row !== null;
  }

  async insert(table: string, record: Record<string, unknown>): Promise<{ id: number }> {
    const keys = Object.keys(record);
    if (keys.length === 0) throw new Error("Cannot insert empty record");

    const placeholders = keys.map(() => "?").join(", ");
    const cols = keys.map((k) => `"${k}"`).join(", ");
    const result = this.db
      .query(`INSERT INTO "${table}" (${cols}) VALUES (${placeholders})`)
      .run(...Object.values(record));
    return { id: Number(result.lastInsertRowid) };
  }

  async query(table: string, options: QueryOptions): Promise<Record<string, unknown>[]> {
    let sql = `SELECT * FROM "${table}"`;
    const params: (string | number | boolean)[] = [];

    if (options.filters && options.filters.length > 0) {
      const clauses = options.filters.map((f) => {
        params.push(f.value);
        return `"${f.column}" ${f.operator} ?`;
      });
      sql += ` WHERE ${clauses.join(" AND ")}`;
    }

    if (options.orderBy) {
      const dir = options.orderBy.direction === "desc" ? "DESC" : "ASC";
      sql += ` ORDER BY "${options.orderBy.column}" ${dir}`;
    }

    if (options.limit !== undefined) {
      sql += ` LIMIT ${options.limit}`;
    }

    return this.db.query(sql).all(...params) as Record<string, unknown>[];
  }

  async update(table: string, id: number, record: Partial<Record<string, unknown>>): Promise<void> {
    const keys = Object.keys(record);
    if (keys.length === 0) throw new Error("No fields to update");

    const sets = keys.map((k) => `"${k}" = ?`).join(", ");
    const values = Object.values(record);
    this.db.query(`UPDATE "${table}" SET ${sets} WHERE id = ?`).run(...values, id);
  }

  async delete(table: string, id: number): Promise<void> {
    this.db.query(`DELETE FROM "${table}" WHERE id = ?`).run(id);
  }

  async count(table: string, filters?: QueryFilter[]): Promise<number> {
    let sql = `SELECT COUNT(*) as cnt FROM "${table}"`;
    const params: (string | number | boolean)[] = [];

    if (filters && filters.length > 0) {
      const clauses = filters.map((f) => {
        params.push(f.value);
        return `"${f.column}" ${f.operator} ?`;
      });
      sql += ` WHERE ${clauses.join(" AND ")}`;
    }

    const row = this.db.query(sql).get(...params) as { cnt: number };
    return row.cnt;
  }

  async mutate(sql: string, params: (string | number | boolean)[] = []): Promise<{ rowsAffected: number; lastInsertRowid: number }> {
    const prefix = sql.trimStart().toUpperCase();
    const allowed = ["INSERT", "UPDATE", "DELETE"];
    const rejected = ["SELECT", "CREATE", "DROP", "ALTER", "TRUNCATE"];

    if (rejected.some((k) => prefix.startsWith(k))) {
      throw new Error(`Statement type not allowed. Only INSERT, UPDATE, DELETE are permitted.`);
    }
    if (!allowed.some((k) => prefix.startsWith(k))) {
      throw new Error(`Statement type not allowed. Only INSERT, UPDATE, DELETE are permitted.`);
    }

    const txn = this.db.transaction(() => {
      return this.db.query(sql).run(...params);
    });
    const result = txn();
    return { rowsAffected: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
  }

  async execute(sql: string, params: (string | number | boolean)[] = []): Promise<Record<string, unknown>[]> {
    const prefix = sql.trimStart().toUpperCase();
    if (!prefix.startsWith("SELECT") && !prefix.startsWith("WITH")) {
      throw new Error("Only SELECT and WITH (CTE) statements are allowed");
    }
    return this.db.query(sql).all(...params) as Record<string, unknown>[];
  }

  private mapSqliteType(sqliteType: string): "text" | "integer" | "real" | "boolean" {
    const t = sqliteType.toUpperCase();
    if (t.includes("INT")) return "integer";
    if (t.includes("REAL") || t.includes("FLOAT") || t.includes("DOUBLE")) return "real";
    return "text";
  }

  close(): void {
    this.db.close();
  }
}
