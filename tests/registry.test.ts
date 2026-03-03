import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync } from "fs";
import { DatabaseRegistry } from "../src/db/registry.ts";

const TEST_DIR = "/tmp/test-instant-db-registry";

function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
}

beforeEach(cleanup);
afterEach(cleanup);

describe("DatabaseRegistry", () => {
  it("starts with empty list", () => {
    const registry = new DatabaseRegistry(TEST_DIR);
    expect(registry.list()).toEqual([]);
  });

  it("creates a database and lists it", async () => {
    const registry = new DatabaseRegistry(TEST_DIR);
    await registry.create("workouts");
    expect(registry.list()).toContain("workouts");
  });

  it("exists returns true after creation", async () => {
    const registry = new DatabaseRegistry(TEST_DIR);
    expect(registry.exists("workouts")).toBe(false);
    await registry.create("workouts");
    expect(registry.exists("workouts")).toBe(true);
  });

  it("throws if creating a duplicate", async () => {
    const registry = new DatabaseRegistry(TEST_DIR);
    await registry.create("workouts");
    expect(() => registry.create("workouts")).toThrow(/already exists/);
  });

  it("throws if getting unknown database", () => {
    const registry = new DatabaseRegistry(TEST_DIR);
    expect(() => registry.get("missing")).toThrow(/does not exist/);
  });

  it("returns a working adapter", async () => {
    const registry = new DatabaseRegistry(TEST_DIR);
    const adapter = await registry.create("testdb");
    await adapter.createTable({ name: "items", columns: [{ name: "label", type: "text" }] });
    const { id } = await adapter.insert("items", { label: "hello" });
    expect(id).toBe(1);
  });

  it("persists manifest across instances", async () => {
    const r1 = new DatabaseRegistry(TEST_DIR);
    await r1.create("mydb");

    const r2 = new DatabaseRegistry(TEST_DIR);
    expect(r2.list()).toContain("mydb");
    expect(r2.exists("mydb")).toBe(true);
  });
});
