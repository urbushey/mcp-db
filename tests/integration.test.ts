/**
 * Full end-to-end integration test simulating a real AI assistant session:
 * propose schema → create database → insert records → query → update → delete → count
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync } from "fs";
import { DatabaseRegistry } from "../src/db/registry.ts";
import { Logger } from "../src/logger.ts";
import { registerDatabaseTools } from "../src/tools/database.ts";
import { registerSchemaTools } from "../src/tools/schema.ts";
import { registerRecordTools } from "../src/tools/records.ts";

const TEST_DIR = "/tmp/test-instant-db-integration";
const TEST_LOG = "/tmp/test-instant-db-integration.log";

function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  if (existsSync(TEST_LOG)) rmSync(TEST_LOG);
}

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

type McpResult = { content: { text: string }[]; isError?: boolean };

beforeEach(cleanup);
afterEach(cleanup);

describe("Integration: workout tracker", () => {
  let server: ReturnType<typeof makeFakeServer>;

  beforeEach(() => {
    const registry = new DatabaseRegistry(TEST_DIR);
    const logger = new Logger({ LOG_LEVEL: "normal", LOG_PATH: TEST_LOG });
    server = makeFakeServer();
    registerDatabaseTools(server, registry, logger);
    registerSchemaTools(server, registry, logger);
    registerRecordTools(server, registry, logger);
  });

  it("runs the full user journey", async () => {
    // 1. List databases — should be empty
    let res = await server.call("list_databases", {}) as McpResult;
    let data = JSON.parse(res.content[0]!.text);
    expect(data.databases).toEqual([]);

    // 2. Propose a schema
    res = await server.call("propose_schema", {
      description: "I want to track my workouts — exercises, sets, reps, and weights",
    }) as McpResult;
    data = JSON.parse(res.content[0]!.text);
    expect(data.description).toContain("workouts");

    // 3. Create the database with confirmed schema
    res = await server.call("create_database", {
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
            { name: "date", type: "text", required: true },
            { name: "exercise", type: "text", required: true },
            { name: "sets", type: "integer" },
            { name: "reps", type: "integer" },
            { name: "weight_lbs", type: "real" },
            { name: "mood", type: "text" },
          ],
        },
      ],
    }) as McpResult;
    data = JSON.parse(res.content[0]!.text);
    expect(data.success).toBe(true);

    // 4. List databases — should now include "workouts"
    res = await server.call("list_databases", {}) as McpResult;
    data = JSON.parse(res.content[0]!.text);
    expect(data.databases).toContain("workouts");

    // 5. Describe the database
    res = await server.call("describe_database", { database: "workouts" }) as McpResult;
    data = JSON.parse(res.content[0]!.text);
    const tableNames = data.tables.map((t: { name: string }) => t.name);
    expect(tableNames).toContain("exercises");
    expect(tableNames).toContain("workout_logs");

    // 6. Insert an exercise
    res = await server.call("insert_record", {
      database: "workouts",
      table: "exercises",
      record: { name: "Squat", category: "legs" },
    }) as McpResult;
    data = JSON.parse(res.content[0]!.text);
    expect(data.id).toBe(1);

    // 7. Log a workout
    res = await server.call("insert_record", {
      database: "workouts",
      table: "workout_logs",
      record: {
        date: "2024-01-15",
        exercise: "Squat",
        sets: 3,
        reps: 8,
        weight_lbs: 185,
        mood: "great",
      },
    }) as McpResult;
    data = JSON.parse(res.content[0]!.text);
    const logId = data.id as number;
    expect(logId).toBe(1);

    // 8. Query all workout logs
    res = await server.call("query_records", {
      database: "workouts",
      table: "workout_logs",
      options: {},
    }) as McpResult;
    data = JSON.parse(res.content[0]!.text);
    expect(data.count).toBe(1);
    expect(data.records[0].exercise).toBe("Squat");
    expect(data.records[0].weight_lbs).toBe(185);

    // 9. Query with filter (mood = great)
    res = await server.call("query_records", {
      database: "workouts",
      table: "workout_logs",
      options: { filters: [{ column: "mood", operator: "=", value: "great" }] },
    }) as McpResult;
    data = JSON.parse(res.content[0]!.text);
    expect(data.count).toBe(1);

    // 10. Update the weight
    res = await server.call("update_record", {
      database: "workouts",
      table: "workout_logs",
      id: logId,
      updates: { weight_lbs: 190 },
    }) as McpResult;
    data = JSON.parse(res.content[0]!.text);
    expect(data.success).toBe(true);

    // 11. Count records
    res = await server.call("count_records", {
      database: "workouts",
      table: "workout_logs",
    }) as McpResult;
    data = JSON.parse(res.content[0]!.text);
    expect(data.count).toBe(1);

    // 12. Delete the log
    res = await server.call("delete_record", {
      database: "workouts",
      table: "workout_logs",
      id: logId,
    }) as McpResult;
    data = JSON.parse(res.content[0]!.text);
    expect(data.success).toBe(true);

    // 13. Count again — should be 0
    res = await server.call("count_records", {
      database: "workouts",
      table: "workout_logs",
    }) as McpResult;
    data = JSON.parse(res.content[0]!.text);
    expect(data.count).toBe(0);
  });

  it("supports multiple independent databases", async () => {
    await server.call("create_database", {
      database: "calories",
      tables: [{ name: "meals", columns: [{ name: "food", type: "text" }, { name: "kcal", type: "integer" }] }],
    });
    await server.call("create_database", {
      database: "finances",
      tables: [{ name: "expenses", columns: [{ name: "item", type: "text" }, { name: "amount", type: "real" }] }],
    });

    const res = await server.call("list_databases", {}) as McpResult;
    const data = JSON.parse(res.content[0]!.text);
    expect(data.databases).toContain("calories");
    expect(data.databases).toContain("finances");

    // Insert into each
    await server.call("insert_record", { database: "calories", table: "meals", record: { food: "oatmeal", kcal: 300 } });
    await server.call("insert_record", { database: "finances", table: "expenses", record: { item: "coffee", amount: 4.5 } });

    const cals = await server.call("query_records", { database: "calories", table: "meals", options: {} }) as McpResult;
    const fins = await server.call("query_records", { database: "finances", table: "expenses", options: {} }) as McpResult;

    expect(JSON.parse(cals.content[0]!.text).count).toBe(1);
    expect(JSON.parse(fins.content[0]!.text).count).toBe(1);
  });
});
