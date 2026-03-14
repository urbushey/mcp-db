import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync } from "fs";
import { SqliteAdapter } from "../src/db/sqlite.ts";

const TEST_DB = "/tmp/test-instant-db-adapter.sqlite";

let adapter: SqliteAdapter;

function cleanupDb() {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(TEST_DB + suffix)) rmSync(TEST_DB + suffix);
  }
}

beforeEach(() => {
  cleanupDb();
  adapter = new SqliteAdapter(TEST_DB);
});

afterEach(() => {
  adapter.close();
  cleanupDb();
});

describe("SqliteAdapter", () => {
  describe("createTable / getTables / tableExists", () => {
    it("creates a table and reports it exists", async () => {
      await adapter.createTable({
        name: "users",
        columns: [
          { name: "name", type: "text", required: true },
          { name: "age", type: "integer" },
        ],
      });

      expect(await adapter.tableExists("users")).toBe(true);
      expect(await adapter.tableExists("missing")).toBe(false);
    });

    it("getTables returns created schema", async () => {
      await adapter.createTable({
        name: "items",
        columns: [{ name: "label", type: "text", required: true }],
      });

      const tables = await adapter.getTables();
      expect(tables.length).toBe(1);
      expect(tables[0]!.name).toBe("items");
      const cols = tables[0]!.columns.map((c) => c.name);
      expect(cols).toContain("id");
      expect(cols).toContain("label");
    });
  });

  describe("insert / query", () => {
    beforeEach(async () => {
      await adapter.createTable({
        name: "fruits",
        columns: [
          { name: "name", type: "text", required: true },
          { name: "weight", type: "real" },
        ],
      });
    });

    it("inserts a record and returns an id", async () => {
      const { id } = await adapter.insert("fruits", { name: "apple", weight: 0.3 });
      expect(id).toBe(1);
    });

    it("queries all records", async () => {
      await adapter.insert("fruits", { name: "apple", weight: 0.3 });
      await adapter.insert("fruits", { name: "banana", weight: 0.2 });

      const rows = await adapter.query("fruits", {});
      expect(rows.length).toBe(2);
    });

    it("filters with = operator", async () => {
      await adapter.insert("fruits", { name: "apple", weight: 0.3 });
      await adapter.insert("fruits", { name: "banana", weight: 0.2 });

      const rows = await adapter.query("fruits", {
        filters: [{ column: "name", operator: "=", value: "apple" }],
      });
      expect(rows.length).toBe(1);
      expect(rows[0]!["name"]).toBe("apple");
    });

    it("orders results", async () => {
      await adapter.insert("fruits", { name: "banana", weight: 0.2 });
      await adapter.insert("fruits", { name: "apple", weight: 0.3 });

      const rows = await adapter.query("fruits", {
        orderBy: { column: "name", direction: "asc" },
      });
      expect(rows[0]!["name"]).toBe("apple");
      expect(rows[1]!["name"]).toBe("banana");
    });

    it("limits results", async () => {
      await adapter.insert("fruits", { name: "apple", weight: 0.3 });
      await adapter.insert("fruits", { name: "banana", weight: 0.2 });

      const rows = await adapter.query("fruits", { limit: 1 });
      expect(rows.length).toBe(1);
    });
  });

  describe("update", () => {
    it("updates a record by id", async () => {
      await adapter.createTable({
        name: "things",
        columns: [{ name: "value", type: "text" }],
      });
      const { id } = await adapter.insert("things", { value: "old" });
      await adapter.update("things", id, { value: "new" });

      const rows = await adapter.query("things", {});
      expect(rows[0]!["value"]).toBe("new");
    });
  });

  describe("delete", () => {
    it("deletes a record by id", async () => {
      await adapter.createTable({
        name: "things",
        columns: [{ name: "value", type: "text" }],
      });
      const { id } = await adapter.insert("things", { value: "bye" });
      await adapter.delete("things", id);

      const rows = await adapter.query("things", {});
      expect(rows.length).toBe(0);
    });
  });

  describe("execute", () => {
    beforeEach(async () => {
      await adapter.createTable({
        name: "fruits",
        columns: [
          { name: "name", type: "text", required: true },
          { name: "weight", type: "real" },
        ],
      });
      await adapter.insert("fruits", { name: "apple", weight: 0.3 });
      await adapter.insert("fruits", { name: "banana", weight: 0.2 });
    });

    it("runs a SELECT query", async () => {
      const rows = await adapter.execute("SELECT * FROM fruits");
      expect(rows.length).toBe(2);
    });

    it("supports bind params", async () => {
      const rows = await adapter.execute("SELECT * FROM fruits WHERE name = ?", ["apple"]);
      expect(rows.length).toBe(1);
      expect(rows[0]!["name"]).toBe("apple");
    });

    it("allows WITH (CTE) queries", async () => {
      const rows = await adapter.execute(
        "WITH heavy AS (SELECT * FROM fruits WHERE weight > 0.25) SELECT name FROM heavy"
      );
      expect(rows.length).toBe(1);
      expect(rows[0]!["name"]).toBe("apple");
    });

    it("rejects INSERT", async () => {
      expect(adapter.execute("INSERT INTO fruits (name) VALUES ('pear')")).rejects.toThrow(
        /Only SELECT and WITH/
      );
    });

    it("rejects DELETE", async () => {
      expect(adapter.execute("DELETE FROM fruits WHERE id = 1")).rejects.toThrow(
        /Only SELECT and WITH/
      );
    });

    it("rejects DROP", async () => {
      expect(adapter.execute("DROP TABLE fruits")).rejects.toThrow(
        /Only SELECT and WITH/
      );
    });
  });

  describe("mutate", () => {
    beforeEach(async () => {
      await adapter.createTable({
        name: "items",
        columns: [
          { name: "name", type: "text", required: true },
          { name: "qty", type: "integer" },
        ],
      });
    });

    it("INSERT returns rowsAffected and lastInsertRowid", async () => {
      const result = await adapter.mutate("INSERT INTO items (name, qty) VALUES (?, ?)", ["apple", 5]);
      expect(result.rowsAffected).toBe(1);
      expect(result.lastInsertRowid).toBe(1);
    });

    it("UPDATE updates matching rows", async () => {
      await adapter.mutate("INSERT INTO items (name, qty) VALUES (?, ?)", ["apple", 5]);
      await adapter.mutate("INSERT INTO items (name, qty) VALUES (?, ?)", ["banana", 3]);
      const result = await adapter.mutate("UPDATE items SET qty = 10 WHERE name = ?", ["apple"]);
      expect(result.rowsAffected).toBe(1);
    });

    it("DELETE deletes matching rows", async () => {
      await adapter.mutate("INSERT INTO items (name, qty) VALUES (?, ?)", ["apple", 5]);
      await adapter.mutate("INSERT INTO items (name, qty) VALUES (?, ?)", ["banana", 3]);
      const result = await adapter.mutate("DELETE FROM items WHERE qty < ?", [4]);
      expect(result.rowsAffected).toBe(1);
    });

    it("rejects SELECT", async () => {
      expect(adapter.mutate("SELECT * FROM items")).rejects.toThrow(/not allowed/);
    });

    it("rejects DROP/CREATE/ALTER", async () => {
      expect(adapter.mutate("DROP TABLE items")).rejects.toThrow(/not allowed/);
      expect(adapter.mutate("CREATE TABLE foo (id INTEGER)")).rejects.toThrow(/not allowed/);
      expect(adapter.mutate("ALTER TABLE items ADD COLUMN x TEXT")).rejects.toThrow(/not allowed/);
    });

    it("rolls back on error", async () => {
      await adapter.createTable({
        name: "uniq",
        columns: [{ name: "val", type: "text", required: true }],
      });
      // Add a unique constraint via raw db access
      await adapter.execute("SELECT 1"); // just verifying adapter works
      await adapter.mutate("INSERT INTO uniq (val) VALUES (?)", ["a"]);
      // Inserting a row with NULL for NOT NULL column should fail
      expect(adapter.mutate("INSERT INTO uniq (val) VALUES (NULL)")).rejects.toThrow();
      // Original row should still be there
      const rows = await adapter.execute("SELECT * FROM uniq");
      expect(rows.length).toBe(1);
    });
  });

  describe("count", () => {
    it("counts all records", async () => {
      await adapter.createTable({
        name: "things",
        columns: [{ name: "value", type: "text" }],
      });
      await adapter.insert("things", { value: "a" });
      await adapter.insert("things", { value: "b" });

      expect(await adapter.count("things")).toBe(2);
    });

    it("counts with filters", async () => {
      await adapter.createTable({
        name: "things",
        columns: [{ name: "value", type: "text" }],
      });
      await adapter.insert("things", { value: "a" });
      await adapter.insert("things", { value: "b" });

      expect(await adapter.count("things", [{ column: "value", operator: "=", value: "a" }])).toBe(1);
    });
  });
});
