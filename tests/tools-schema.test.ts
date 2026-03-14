import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync } from "fs";
import { DatabaseRegistry } from "../src/db/registry.ts";
import { Logger } from "../src/logger.ts";
import { registerSchemaTools } from "../src/tools/schema.ts";

const TEST_DIR = "/tmp/test-instant-db-tools-schema";
const TEST_LOG = "/tmp/test-instant-db-tools-schema.log";

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

describe("schema tools", () => {
  let server: ReturnType<typeof makeFakeServer>;
  let registry: DatabaseRegistry;
  let logger: Logger;

  beforeEach(() => {
    registry = new DatabaseRegistry(TEST_DIR);
    logger = new Logger({ LOG_LEVEL: "off", LOG_PATH: TEST_LOG });
    server = makeFakeServer();
    registerSchemaTools(server, registry, logger);
  });

  describe("propose_schema", () => {
    it("returns description and tables structure", async () => {
      const result = await server.call("propose_schema", {
        description: "I want to track workouts",
      }) as { content: { text: string }[] };

      const data = JSON.parse(result.content[0]!.text);
      expect(data.description).toBe("I want to track workouts");
      expect(Array.isArray(data.tables)).toBe(true);
      expect(typeof data.summary).toBe("string");
    });

    it("returns existing_proposal when provided", async () => {
      const existing = [
        {
          name: "exercises",
          columns: [{ name: "name", type: "text", required: true }],
        },
      ];

      const result = await server.call("propose_schema", {
        description: "Add a notes field",
        existing_proposal: existing,
      }) as { content: { text: string }[] };

      const data = JSON.parse(result.content[0]!.text);
      expect(data.tables).toHaveLength(1);
      expect(data.tables[0].name).toBe("exercises");
    });
  });

  describe("create_database", () => {
    it("creates a database with tables", async () => {
      const result = await server.call("create_database", {
        database: "workouts",
        tables: [
          {
            name: "exercises",
            columns: [
              { name: "name", type: "text", required: true },
              { name: "category", type: "text" },
            ],
          },
          {
            name: "workout_logs",
            columns: [
              { name: "date", type: "text" },
              { name: "exercise", type: "text" },
              { name: "sets", type: "integer" },
              { name: "reps", type: "integer" },
              { name: "weight_lbs", type: "real" },
            ],
          },
        ],
      }) as { content: { text: string }[] };

      const data = JSON.parse(result.content[0]!.text);
      expect(data.success).toBe(true);
      expect(data.database).toBe("workouts");
      expect(data.tables).toContain("exercises");
      expect(data.tables).toContain("workout_logs");

      // Verify the database actually exists with tables
      expect(registry.exists("workouts")).toBe(true);
      const adapter = registry.get("workouts");
      const tables = await adapter.getTables();
      expect(tables.map((t) => t.name)).toContain("exercises");
      expect(tables.map((t) => t.name)).toContain("workout_logs");
    });

    it("returns error for empty/invalid name", async () => {
      const result = await server.call("create_database", {
        database: "",
        tables: [],
      }) as { isError: boolean; content: { text: string }[] };

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0]!.text);
      expect(data.error).toMatch(/non-empty string/);
    });

    it("returns error if database already exists", async () => {
      await registry.create("mydb");

      const result = await server.call("create_database", {
        database: "mydb",
        tables: [],
      }) as { isError: boolean; content: { text: string }[] };

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0]!.text);
      expect(data.error).toMatch(/already exists/);
    });
  });
});
