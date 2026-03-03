import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync } from "fs";
import { DatabaseRegistry } from "../src/db/registry.ts";
import { Logger } from "../src/logger.ts";
import { registerRecordTools } from "../src/tools/records.ts";

const TEST_DIR = "/tmp/test-instant-db-tools-records";
const TEST_LOG = "/tmp/test-instant-db-tools-records.log";

function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  if (existsSync(TEST_LOG)) rmSync(TEST_LOG);
}

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

describe("record tools", () => {
  let server: ReturnType<typeof makeFakeServer>;
  let registry: DatabaseRegistry;
  let logger: Logger;

  beforeEach(async () => {
    registry = new DatabaseRegistry(TEST_DIR);
    logger = new Logger({ LOG_LEVEL: "off", LOG_PATH: TEST_LOG });
    server = makeFakeServer();
    registerRecordTools(server, registry, logger);

    // Seed a database with a table for tests
    const adapter = await registry.create("testdb");
    await adapter.createTable({
      name: "fruits",
      columns: [
        { name: "name", type: "text", required: true },
        { name: "weight", type: "real" },
        { name: "color", type: "text" },
      ],
    });
  });

  describe("insert_record", () => {
    it("inserts a record and returns id", async () => {
      const result = await server.call("insert_record", {
        database: "testdb",
        table: "fruits",
        record: { name: "apple", weight: 0.3, color: "red" },
      }) as { content: { text: string }[] };

      const data = JSON.parse(result.content[0]!.text);
      expect(data.id).toBe(1);
    });

    it("returns error for unknown database", async () => {
      const result = await server.call("insert_record", {
        database: "missing",
        table: "fruits",
        record: { name: "apple" },
      }) as { isError: boolean; content: { text: string }[] };

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0]!.text);
      expect(data.error).toMatch(/does not exist/);
    });
  });

  describe("query_records", () => {
    beforeEach(async () => {
      const adapter = registry.get("testdb");
      await adapter.insert("fruits", { name: "apple", weight: 0.3, color: "red" });
      await adapter.insert("fruits", { name: "banana", weight: 0.2, color: "yellow" });
      await adapter.insert("fruits", { name: "cherry", weight: 0.01, color: "red" });
    });

    it("returns all records with no options", async () => {
      const result = await server.call("query_records", {
        database: "testdb",
        table: "fruits",
        options: {},
      }) as { content: { text: string }[] };

      const data = JSON.parse(result.content[0]!.text);
      expect(data.count).toBe(3);
      expect(data.records).toHaveLength(3);
    });

    it("filters records", async () => {
      const result = await server.call("query_records", {
        database: "testdb",
        table: "fruits",
        options: {
          filters: [{ column: "color", operator: "=", value: "red" }],
        },
      }) as { content: { text: string }[] };

      const data = JSON.parse(result.content[0]!.text);
      expect(data.count).toBe(2);
    });

    it("orders records", async () => {
      const result = await server.call("query_records", {
        database: "testdb",
        table: "fruits",
        options: { orderBy: { column: "name", direction: "asc" } },
      }) as { content: { text: string }[] };

      const data = JSON.parse(result.content[0]!.text);
      expect(data.records[0].name).toBe("apple");
    });

    it("limits records", async () => {
      const result = await server.call("query_records", {
        database: "testdb",
        table: "fruits",
        options: { limit: 2 },
      }) as { content: { text: string }[] };

      const data = JSON.parse(result.content[0]!.text);
      expect(data.count).toBe(2);
    });
  });

  describe("update_record", () => {
    it("updates a record", async () => {
      const adapter = registry.get("testdb");
      const { id } = await adapter.insert("fruits", { name: "apple", weight: 0.3, color: "red" });

      await server.call("update_record", {
        database: "testdb",
        table: "fruits",
        id,
        updates: { color: "green" },
      });

      const rows = await adapter.query("fruits", {});
      expect(rows[0]!["color"]).toBe("green");
    });

    it("returns success", async () => {
      const adapter = registry.get("testdb");
      const { id } = await adapter.insert("fruits", { name: "apple" });

      const result = await server.call("update_record", {
        database: "testdb",
        table: "fruits",
        id,
        updates: { name: "pear" },
      }) as { content: { text: string }[] };

      const data = JSON.parse(result.content[0]!.text);
      expect(data.success).toBe(true);
    });
  });

  describe("delete_record", () => {
    it("deletes a record", async () => {
      const adapter = registry.get("testdb");
      const { id } = await adapter.insert("fruits", { name: "apple" });
      expect((await adapter.query("fruits", {})).length).toBe(1);

      await server.call("delete_record", { database: "testdb", table: "fruits", id });

      expect((await adapter.query("fruits", {})).length).toBe(0);
    });

    it("returns success", async () => {
      const adapter = registry.get("testdb");
      const { id } = await adapter.insert("fruits", { name: "apple" });

      const result = await server.call("delete_record", {
        database: "testdb",
        table: "fruits",
        id,
      }) as { content: { text: string }[] };

      const data = JSON.parse(result.content[0]!.text);
      expect(data.success).toBe(true);
    });
  });

  describe("count_records", () => {
    beforeEach(async () => {
      const adapter = registry.get("testdb");
      await adapter.insert("fruits", { name: "apple", color: "red" });
      await adapter.insert("fruits", { name: "banana", color: "yellow" });
      await adapter.insert("fruits", { name: "cherry", color: "red" });
    });

    it("counts all records", async () => {
      const result = await server.call("count_records", {
        database: "testdb",
        table: "fruits",
      }) as { content: { text: string }[] };

      const data = JSON.parse(result.content[0]!.text);
      expect(data.count).toBe(3);
    });

    it("counts with filter", async () => {
      const result = await server.call("count_records", {
        database: "testdb",
        table: "fruits",
        filters: [{ column: "color", operator: "=", value: "red" }],
      }) as { content: { text: string }[] };

      const data = JSON.parse(result.content[0]!.text);
      expect(data.count).toBe(2);
    });
  });
});
