import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, renameSync } from "fs";
import { join } from "path";
import type { IDbAdapter } from "./adapter.ts";
import { SqliteAdapter } from "./sqlite.ts";

export class DatabaseRegistry {
  private adapters: Map<string, SqliteAdapter> = new Map();
  private metaDb: Database;
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;

    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    const metaPath = join(dataDir, "_metadata.sqlite");
    const jsonPath = join(dataDir, "_registry.json");
    const needsMigration = existsSync(jsonPath) && !existsSync(metaPath);

    this.metaDb = new Database(metaPath);
    this.metaDb.run("PRAGMA journal_mode = WAL");
    this.metaDb.run("PRAGMA foreign_keys = ON");

    this.metaDb.run(`
      CREATE TABLE IF NOT EXISTS databases (
        name TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        description TEXT,
        notes TEXT,
        created_at TEXT NOT NULL
      )
    `);

    this.metaDb.run(`
      CREATE TABLE IF NOT EXISTS fields (
        database_name TEXT NOT NULL,
        table_name TEXT NOT NULL,
        column_name TEXT NOT NULL,
        display_name TEXT,
        description TEXT,
        PRIMARY KEY (database_name, table_name, column_name),
        FOREIGN KEY (database_name) REFERENCES databases(name)
      )
    `);

    if (needsMigration) {
      this.migrateFromJson(jsonPath);
    }
  }

  private migrateFromJson(jsonPath: string): void {
    const raw = readFileSync(jsonPath, "utf-8");
    const manifest = JSON.parse(raw) as { databases: { name: string; path: string; createdAt: string }[] };

    const insert = this.metaDb.prepare(
      "INSERT OR IGNORE INTO databases (name, path, created_at) VALUES (?, ?, ?)"
    );
    const txn = this.metaDb.transaction(() => {
      for (const entry of manifest.databases) {
        insert.run(entry.name, entry.path, entry.createdAt);
      }
    });
    txn();

    renameSync(jsonPath, jsonPath + ".bak");
  }

  list(): string[] {
    const rows = this.metaDb.query("SELECT name FROM databases").all() as { name: string }[];
    return rows.map((r) => r.name);
  }

  exists(name: string): boolean {
    const row = this.metaDb.query("SELECT 1 FROM databases WHERE name = ?").get(name);
    return row !== null;
  }

  get(name: string): IDbAdapter {
    if (!this.exists(name)) {
      throw new Error(`Database "${name}" does not exist`);
    }

    if (!this.adapters.has(name)) {
      const row = this.metaDb.query("SELECT path FROM databases WHERE name = ?").get(name) as { path: string };
      this.adapters.set(name, new SqliteAdapter(row.path));
    }

    return this.adapters.get(name)!;
  }

  async create(name: string): Promise<IDbAdapter> {
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      throw new Error("Database name must be a non-empty string");
    }
    if (/[/\\]|\.\./.test(name)) {
      throw new Error("Database name contains unsafe characters");
    }
    if (this.exists(name)) {
      throw new Error(`Database "${name}" already exists`);
    }

    const filePath = join(this.dataDir, `${name}.sqlite`);
    const adapter = new SqliteAdapter(filePath);
    this.adapters.set(name, adapter);

    this.metaDb.run(
      "INSERT INTO databases (name, path, created_at) VALUES (?, ?, ?)",
      [name, filePath, new Date().toISOString()]
    );

    return adapter;
  }

  close(): void {
    this.metaDb.close();
  }
}
