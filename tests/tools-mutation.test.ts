import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync } from "fs";
import { DatabaseRegistry } from "../src/db/registry.ts";
import { Logger } from "../src/logger.ts";
import { registerMutationTools } from "../src/tools/mutation.ts";
import { registerSchemaTools } from "../src/tools/schema.ts";

const TEST_DIR = "/tmp/test-instant-db-tools-mutation";
const TEST_LOG = "/tmp/test-instant-db-tools-mutation.log";

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

type McpResult = { content: { text: string }[]; isError?: boolean };

beforeEach(cleanup);
afterEach(cleanup);

describe("execute_mutation tool", () => {
  let server: ReturnType<typeof makeFakeServer>;
  let registry: DatabaseRegistry;
  let logger: Logger;

  beforeEach(async () => {
    registry = new DatabaseRegistry(TEST_DIR);
    logger = new Logger({ LOG_LEVEL: "off", LOG_PATH: TEST_LOG });
    server = makeFakeServer();
    registerSchemaTools(server, registry, logger);
    registerMutationTools(server, registry, logger);

    // Create a test database with a table
    await server.call("create_database", {
      database: "testdb",
      tables: [
        {
          name: "items",
          columns: [
            { name: "name", type: "text", required: true },
            { name: "qty", type: "integer" },
          ],
        },
      ],
    });
  });

  it("inserts via SQL", async () => {
    const res = await server.call("execute_mutation", {
      database: "testdb",
      sql: "INSERT INTO items (name, qty) VALUES ('apple', 5)",
    }) as McpResult;
    const data = JSON.parse(res.content[0]!.text);
    expect(data.rowsAffected).toBe(1);
    expect(data.lastInsertRowid).toBe(1);
  });

  it("UPDATE WHERE affects correct rows", async () => {
    await server.call("execute_mutation", {
      database: "testdb",
      sql: "INSERT INTO items (name, qty) VALUES ('apple', 5)",
    });
    await server.call("execute_mutation", {
      database: "testdb",
      sql: "INSERT INTO items (name, qty) VALUES ('banana', 3)",
    });

    const res = await server.call("execute_mutation", {
      database: "testdb",
      sql: "UPDATE items SET qty = 99 WHERE name = 'apple'",
    }) as McpResult;
    const data = JSON.parse(res.content[0]!.text);
    expect(data.rowsAffected).toBe(1);
  });

  it("DELETE WHERE affects correct rows", async () => {
    await server.call("execute_mutation", {
      database: "testdb",
      sql: "INSERT INTO items (name, qty) VALUES ('apple', 5)",
    });
    await server.call("execute_mutation", {
      database: "testdb",
      sql: "INSERT INTO items (name, qty) VALUES ('banana', 3)",
    });

    const res = await server.call("execute_mutation", {
      database: "testdb",
      sql: "DELETE FROM items WHERE qty < 4",
    }) as McpResult;
    const data = JSON.parse(res.content[0]!.text);
    expect(data.rowsAffected).toBe(1);
  });

  it("supports bind params", async () => {
    const res = await server.call("execute_mutation", {
      database: "testdb",
      sql: "INSERT INTO items (name, qty) VALUES (?, ?)",
      params: ["pear", 7],
    }) as McpResult;
    const data = JSON.parse(res.content[0]!.text);
    expect(data.rowsAffected).toBe(1);
  });

  it("rejects SELECT/DROP/ALTER/CREATE", async () => {
    for (const sql of [
      "SELECT * FROM items",
      "DROP TABLE items",
      "ALTER TABLE items ADD COLUMN x TEXT",
      "CREATE TABLE foo (id INTEGER)",
    ]) {
      const res = await server.call("execute_mutation", {
        database: "testdb",
        sql,
      }) as McpResult;
      expect(res.isError).toBe(true);
      const data = JSON.parse(res.content[0]!.text);
      expect(data.error).toMatch(/not allowed/);
    }
  });

  it("rejects non-existent database", async () => {
    const res = await server.call("execute_mutation", {
      database: "nope",
      sql: "INSERT INTO items (name, qty) VALUES ('x', 1)",
    }) as McpResult;
    expect(res.isError).toBe(true);
    const data = JSON.parse(res.content[0]!.text);
    expect(data.error).toMatch(/does not exist/);
  });

  it("returns error on constraint violation", async () => {
    const res = await server.call("execute_mutation", {
      database: "testdb",
      sql: "INSERT INTO items (name, qty) VALUES (NULL, 1)",
    }) as McpResult;
    expect(res.isError).toBe(true);
  });
});
