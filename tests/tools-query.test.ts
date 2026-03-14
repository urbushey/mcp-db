import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync } from "fs";
import { DatabaseRegistry } from "../src/db/registry.ts";
import { Logger } from "../src/logger.ts";
import { registerQueryTools } from "../src/tools/query.ts";

const TEST_DIR = "/tmp/test-instant-db-tools-query";
const TEST_LOG = "/tmp/test-instant-db-tools-query.log";

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

describe("execute_query tool", () => {
  let server: ReturnType<typeof makeFakeServer>;
  let registry: DatabaseRegistry;
  let logger: Logger;

  beforeEach(async () => {
    registry = new DatabaseRegistry(TEST_DIR);
    logger = new Logger({ LOG_LEVEL: "off", LOG_PATH: TEST_LOG });
    server = makeFakeServer();
    registerQueryTools(server, registry, logger);

    // Seed a database with tables for tests
    const adapter = await registry.create("testdb");
    await adapter.createTable({
      name: "fruits",
      columns: [
        { name: "name", type: "text", required: true },
        { name: "weight", type: "real" },
        { name: "color", type: "text" },
      ],
    });
    await adapter.createTable({
      name: "orders",
      columns: [
        { name: "fruit_id", type: "integer", required: true },
        { name: "quantity", type: "integer", required: true },
      ],
    });

    await adapter.insert("fruits", { name: "apple", weight: 0.3, color: "red" });
    await adapter.insert("fruits", { name: "banana", weight: 0.2, color: "yellow" });
    await adapter.insert("fruits", { name: "cherry", weight: 0.01, color: "red" });

    await adapter.insert("orders", { fruit_id: 1, quantity: 10 });
    await adapter.insert("orders", { fruit_id: 2, quantity: 5 });
    await adapter.insert("orders", { fruit_id: 1, quantity: 3 });
  });

  it("basic SELECT returns rows", async () => {
    const result = await server.call("execute_query", {
      database: "testdb",
      sql: "SELECT * FROM fruits",
    }) as { content: { text: string }[] };

    const data = JSON.parse(result.content[0]!.text);
    expect(data.count).toBe(3);
    expect(data.rows).toHaveLength(3);
  });

  it("SELECT with WHERE clause", async () => {
    const result = await server.call("execute_query", {
      database: "testdb",
      sql: "SELECT * FROM fruits WHERE color = 'red'",
    }) as { content: { text: string }[] };

    const data = JSON.parse(result.content[0]!.text);
    expect(data.count).toBe(2);
    expect(data.rows.every((r: Record<string, unknown>) => r.color === "red")).toBe(true);
  });

  it("SELECT with JOIN across tables", async () => {
    const result = await server.call("execute_query", {
      database: "testdb",
      sql: `SELECT f.name, o.quantity
            FROM orders o
            JOIN fruits f ON f.id = o.fruit_id
            ORDER BY o.quantity DESC`,
    }) as { content: { text: string }[] };

    const data = JSON.parse(result.content[0]!.text);
    expect(data.count).toBe(3);
    expect(data.rows[0].name).toBe("apple");
    expect(data.rows[0].quantity).toBe(10);
  });

  it("SELECT with aggregate (COUNT, SUM)", async () => {
    const result = await server.call("execute_query", {
      database: "testdb",
      sql: `SELECT f.name, COUNT(*) as order_count, SUM(o.quantity) as total_qty
            FROM orders o
            JOIN fruits f ON f.id = o.fruit_id
            GROUP BY f.name
            ORDER BY total_qty DESC`,
    }) as { content: { text: string }[] };

    const data = JSON.parse(result.content[0]!.text);
    expect(data.count).toBe(2);
    expect(data.rows[0].name).toBe("apple");
    expect(data.rows[0].total_qty).toBe(13);
    expect(data.rows[0].order_count).toBe(2);
  });

  it("bind params work correctly", async () => {
    const result = await server.call("execute_query", {
      database: "testdb",
      sql: "SELECT * FROM fruits WHERE color = ? AND weight > ?",
      params: ["red", 0.05],
    }) as { content: { text: string }[] };

    const data = JSON.parse(result.content[0]!.text);
    expect(data.count).toBe(1);
    expect(data.rows[0].name).toBe("apple");
  });

  it("rejects INSERT statement", async () => {
    const result = await server.call("execute_query", {
      database: "testdb",
      sql: "INSERT INTO fruits (name) VALUES ('pear')",
    }) as { isError: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0]!.text);
    expect(data.error).toMatch(/Only SELECT and WITH/);
  });

  it("rejects UPDATE statement", async () => {
    const result = await server.call("execute_query", {
      database: "testdb",
      sql: "UPDATE fruits SET name = 'pear' WHERE id = 1",
    }) as { isError: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
  });

  it("rejects DELETE statement", async () => {
    const result = await server.call("execute_query", {
      database: "testdb",
      sql: "DELETE FROM fruits WHERE id = 1",
    }) as { isError: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
  });

  it("rejects DROP statement", async () => {
    const result = await server.call("execute_query", {
      database: "testdb",
      sql: "DROP TABLE fruits",
    }) as { isError: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
  });

  it("rejects ALTER statement", async () => {
    const result = await server.call("execute_query", {
      database: "testdb",
      sql: "ALTER TABLE fruits ADD COLUMN taste TEXT",
    }) as { isError: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
  });

  it("rejects non-existent database", async () => {
    const result = await server.call("execute_query", {
      database: "nope",
      sql: "SELECT 1",
    }) as { isError: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0]!.text);
    expect(data.error).toMatch(/does not exist/);
  });

  it("WITH (CTE) queries work", async () => {
    const result = await server.call("execute_query", {
      database: "testdb",
      sql: `WITH red_fruits AS (
              SELECT * FROM fruits WHERE color = 'red'
            )
            SELECT name, weight FROM red_fruits ORDER BY weight DESC`,
    }) as { content: { text: string }[] };

    const data = JSON.parse(result.content[0]!.text);
    expect(data.count).toBe(2);
    expect(data.rows[0].name).toBe("apple");
    expect(data.rows[1].name).toBe("cherry");
  });
});
