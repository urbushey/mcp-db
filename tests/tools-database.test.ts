import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync } from "fs";
import { DatabaseRegistry } from "../src/db/registry.ts";
import { Logger } from "../src/logger.ts";
import { registerDatabaseTools } from "../src/tools/database.ts";

const TEST_DIR = "/tmp/test-instant-db-tools-database";
const TEST_LOG = "/tmp/test-instant-db-tools-database.log";

function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  if (existsSync(TEST_LOG)) rmSync(TEST_LOG);
}

// Minimal fake server that captures tool handlers
function makeFakeServer() {
  const tools: Record<string, (args: unknown) => Promise<unknown>> = {};
  return {
    tool(name: string, _desc: string, _schema: object, handler: (args: unknown) => Promise<unknown>) {
      tools[name] = handler;
    },
    call(name: string, args: unknown) {
      const fn = tools[name];
      if (!fn) throw new Error(`Tool ${name} not registered`);
      return fn(args);
    },
  };
}

beforeEach(cleanup);
afterEach(cleanup);

describe("database tools", () => {
  let server: ReturnType<typeof makeFakeServer>;
  let registry: DatabaseRegistry;
  let logger: Logger;

  beforeEach(() => {
    registry = new DatabaseRegistry(TEST_DIR);
    logger = new Logger({ LOG_LEVEL: "off", LOG_PATH: TEST_LOG });
    server = makeFakeServer();
    registerDatabaseTools(server, registry, logger);
  });

  describe("list_databases", () => {
    it("returns empty list initially", async () => {
      const result = await server.call("list_databases", {}) as { content: { text: string }[] };
      const data = JSON.parse(result.content[0]!.text);
      expect(data.databases).toEqual([]);
    });

    it("returns created databases", async () => {
      await registry.create("workouts");
      await registry.create("calories");
      const result = await server.call("list_databases", {}) as { content: { text: string }[] };
      const data = JSON.parse(result.content[0]!.text);
      expect(data.databases).toContain("workouts");
      expect(data.databases).toContain("calories");
    });
  });

  describe("describe_database", () => {
    it("returns error for unknown database", async () => {
      const result = await server.call("describe_database", { database: "missing" }) as { isError: boolean; content: { text: string }[] };
      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0]!.text);
      expect(data.error).toMatch(/does not exist/);
    });

    it("returns schema for existing database", async () => {
      const adapter = await registry.create("mydb");
      await adapter.createTable({
        name: "items",
        columns: [{ name: "label", type: "text", required: true }],
      });

      const result = await server.call("describe_database", { database: "mydb" }) as { content: { text: string }[] };
      const data = JSON.parse(result.content[0]!.text);
      expect(data.tables).toHaveLength(1);
      expect(data.tables[0].name).toBe("items");
    });

    it("returns description and notes alongside schema", async () => {
      await registry.create("mydb", "A test database");
      registry.updateNotes("mydb", "Use integers for IDs");

      const result = await server.call("describe_database", { database: "mydb" }) as { content: { text: string }[] };
      const data = JSON.parse(result.content[0]!.text);
      expect(data.description).toBe("A test database");
      expect(data.notes).toBe("Use integers for IDs");
    });

    it("returns null description and notes when not set", async () => {
      await registry.create("mydb");

      const result = await server.call("describe_database", { database: "mydb" }) as { content: { text: string }[] };
      const data = JSON.parse(result.content[0]!.text);
      expect(data.description).toBeNull();
      expect(data.notes).toBeNull();
    });
  });

  describe("update_database_notes", () => {
    it("sets notes on an existing database", async () => {
      await registry.create("mydb");

      const result = await server.call("update_database_notes", {
        database: "mydb",
        notes: "- dates are YYYY-MM-DD\n- calories are integers",
      }) as { content: { text: string }[] };

      const data = JSON.parse(result.content[0]!.text);
      expect(data.success).toBe(true);

      const meta = registry.getMetadata("mydb");
      expect(meta.notes).toBe("- dates are YYYY-MM-DD\n- calories are integers");
    });

    it("replaces existing notes", async () => {
      await registry.create("mydb");
      registry.updateNotes("mydb", "old notes");

      await server.call("update_database_notes", {
        database: "mydb",
        notes: "new notes",
      });

      const meta = registry.getMetadata("mydb");
      expect(meta.notes).toBe("new notes");
    });

    it("returns error for unknown database", async () => {
      const result = await server.call("update_database_notes", {
        database: "missing",
        notes: "some notes",
      }) as { isError: boolean; content: { text: string }[] };

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0]!.text);
      expect(data.error).toMatch(/does not exist/);
    });
  });

  describe("delete_database", () => {
    it("deletes an existing database", async () => {
      await registry.create("mydb");

      const result = await server.call("delete_database", {
        database: "mydb",
        confirm: true,
      }) as { content: { text: string }[] };

      const data = JSON.parse(result.content[0]!.text);
      expect(data.success).toBe(true);
      expect(registry.exists("mydb")).toBe(false);
    });

    it("returns error without confirm flag", async () => {
      await registry.create("mydb");

      const result = await server.call("delete_database", {
        database: "mydb",
      }) as { isError: boolean; content: { text: string }[] };

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0]!.text);
      expect(data.error).toMatch(/confirm/i);
      // Database should still exist
      expect(registry.exists("mydb")).toBe(true);
    });

    it("returns error with confirm=false", async () => {
      await registry.create("mydb");

      const result = await server.call("delete_database", {
        database: "mydb",
        confirm: false,
      }) as { isError: boolean; content: { text: string }[] };

      expect(result.isError).toBe(true);
      expect(registry.exists("mydb")).toBe(true);
    });

    it("returns error for non-existent database", async () => {
      const result = await server.call("delete_database", {
        database: "missing",
        confirm: true,
      }) as { isError: boolean; content: { text: string }[] };

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0]!.text);
      expect(data.error).toMatch(/does not exist/);
    });

    it("database no longer appears in list_databases after deletion", async () => {
      await registry.create("db1");
      await registry.create("db2");

      await server.call("delete_database", { database: "db1", confirm: true });

      const result = await server.call("list_databases", {}) as { content: { text: string }[] };
      const data = JSON.parse(result.content[0]!.text);
      expect(data.databases).not.toContain("db1");
      expect(data.databases).toContain("db2");
    });
  });

  describe("describe_database with field metadata", () => {
    it("includes field metadata on columns", async () => {
      const adapter = await registry.create("mydb");
      await adapter.createTable({
        name: "meals",
        columns: [
          { name: "meal_type", type: "text", required: true },
          { name: "calories", type: "integer" },
        ],
      });
      registry.updateFieldMetadata("mydb", "meals", "meal_type", "Meal", "One of: breakfast, lunch, dinner, snack");
      registry.updateFieldMetadata("mydb", "meals", "calories", "Calories", "Integer kcal");

      const result = await server.call("describe_database", { database: "mydb" }) as { content: { text: string }[] };
      const data = JSON.parse(result.content[0]!.text);
      const mealTypeCol = data.tables[0].columns.find((c: any) => c.name === "meal_type");
      const calCol = data.tables[0].columns.find((c: any) => c.name === "calories");
      expect(mealTypeCol.displayName).toBe("Meal");
      expect(mealTypeCol.description).toBe("One of: breakfast, lunch, dinner, snack");
      expect(calCol.displayName).toBe("Calories");
      expect(calCol.description).toBe("Integer kcal");
    });

    it("omits displayName/description when not set", async () => {
      const adapter = await registry.create("mydb");
      await adapter.createTable({
        name: "meals",
        columns: [{ name: "cal", type: "integer" }],
      });

      const result = await server.call("describe_database", { database: "mydb" }) as { content: { text: string }[] };
      const data = JSON.parse(result.content[0]!.text);
      const col = data.tables[0].columns.find((c: any) => c.name === "cal");
      expect(col.displayName).toBeUndefined();
      expect(col.description).toBeUndefined();
    });
  });

  describe("update_field_metadata", () => {
    it("sets field metadata", async () => {
      await registry.create("mydb");

      const result = await server.call("update_field_metadata", {
        database: "mydb",
        table: "meals",
        column: "meal_type",
        displayName: "Meal",
        description: "One of: breakfast, lunch, dinner, snack",
      }) as { content: { text: string }[] };

      const data = JSON.parse(result.content[0]!.text);
      expect(data.success).toBe(true);

      const fields = registry.getFieldsMetadata("mydb");
      expect(fields).toHaveLength(1);
      expect(fields[0].display_name).toBe("Meal");
      expect(fields[0].description).toBe("One of: breakfast, lunch, dinner, snack");
    });

    it("works with only displayName", async () => {
      await registry.create("mydb");

      await server.call("update_field_metadata", {
        database: "mydb",
        table: "meals",
        column: "cal",
        displayName: "Calories",
      });

      const fields = registry.getFieldsMetadata("mydb");
      expect(fields[0].display_name).toBe("Calories");
      expect(fields[0].description).toBeNull();
    });

    it("works with only description", async () => {
      await registry.create("mydb");

      await server.call("update_field_metadata", {
        database: "mydb",
        table: "meals",
        column: "cal",
        description: "Integer kcal",
      });

      const fields = registry.getFieldsMetadata("mydb");
      expect(fields[0].display_name).toBeNull();
      expect(fields[0].description).toBe("Integer kcal");
    });

    it("returns error for unknown database", async () => {
      const result = await server.call("update_field_metadata", {
        database: "missing",
        table: "t",
        column: "c",
        displayName: "X",
      }) as { isError: boolean; content: { text: string }[] };

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0]!.text);
      expect(data.error).toMatch(/does not exist/);
    });
  });
});
