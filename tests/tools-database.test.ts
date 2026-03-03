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
    tool(name: string, _schema: object, handler: (args: unknown) => Promise<unknown>) {
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
  });
});
