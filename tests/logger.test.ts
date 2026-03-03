import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync, readFileSync } from "fs";
import { Logger } from "../src/logger.ts";

const TEST_LOG = "/tmp/test-instant-db-logger.log";

beforeEach(() => {
  if (existsSync(TEST_LOG)) rmSync(TEST_LOG);
});

afterEach(() => {
  if (existsSync(TEST_LOG)) rmSync(TEST_LOG);
});

describe("Logger", () => {
  it("writes a JSONL log entry", () => {
    const logger = new Logger({ LOG_LEVEL: "normal", LOG_PATH: TEST_LOG });
    logger.log({
      timestamp: "2024-01-01T00:00:00.000Z",
      tool: "test_tool",
      input: { foo: "bar" },
      output: { result: 42 },
      durationMs: 10,
    });

    const lines = readFileSync(TEST_LOG, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry.tool).toBe("test_tool");
    expect(entry.output.result).toBe(42);
  });

  it("does not write when level is off", () => {
    const logger = new Logger({ LOG_LEVEL: "off", LOG_PATH: TEST_LOG });
    logger.log({
      timestamp: new Date().toISOString(),
      tool: "noop",
      input: {},
      output: {},
      durationMs: 0,
    });
    expect(existsSync(TEST_LOG)).toBe(false);
  });

  it("wrap logs success", async () => {
    const logger = new Logger({ LOG_LEVEL: "normal", LOG_PATH: TEST_LOG });
    const result = await logger.wrap("my_tool", { x: 1 }, async () => ({ y: 2 }));
    expect(result).toEqual({ y: 2 });

    const lines = readFileSync(TEST_LOG, "utf-8").trim().split("\n");
    const entry = JSON.parse(lines[0]!);
    expect(entry.tool).toBe("my_tool");
    expect(entry.output).toEqual({ y: 2 });
    expect(entry.error).toBeUndefined();
  });

  it("wrap logs errors and rethrows", async () => {
    const logger = new Logger({ LOG_LEVEL: "normal", LOG_PATH: TEST_LOG });
    await expect(
      logger.wrap("fail_tool", {}, async () => { throw new Error("boom"); })
    ).rejects.toThrow("boom");

    const lines = readFileSync(TEST_LOG, "utf-8").trim().split("\n");
    const entry = JSON.parse(lines[0]!);
    expect(entry.error).toBe("boom");
  });

  it("appends multiple entries", () => {
    const logger = new Logger({ LOG_LEVEL: "normal", LOG_PATH: TEST_LOG });
    for (let i = 0; i < 3; i++) {
      logger.log({ timestamp: new Date().toISOString(), tool: `tool_${i}`, input: {}, output: {}, durationMs: i });
    }
    const lines = readFileSync(TEST_LOG, "utf-8").trim().split("\n");
    expect(lines.length).toBe(3);
  });
});
