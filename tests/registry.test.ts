import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
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

  it("rejects undefined/null name", () => {
    const registry = new DatabaseRegistry(TEST_DIR);
    expect(() => registry.create(undefined as unknown as string)).toThrow(/non-empty string/);
    expect(() => registry.create(null as unknown as string)).toThrow(/non-empty string/);
  });

  it("rejects empty string name", () => {
    const registry = new DatabaseRegistry(TEST_DIR);
    expect(() => registry.create("")).toThrow(/non-empty string/);
  });

  it("rejects whitespace-only name", () => {
    const registry = new DatabaseRegistry(TEST_DIR);
    expect(() => registry.create("   ")).toThrow(/non-empty string/);
  });

  it("rejects names with filesystem-unsafe characters", () => {
    const registry = new DatabaseRegistry(TEST_DIR);
    expect(() => registry.create("foo/bar")).toThrow(/unsafe characters/);
    expect(() => registry.create("foo\\bar")).toThrow(/unsafe characters/);
    expect(() => registry.create("foo..bar")).toThrow(/unsafe characters/);
  });

  it("returns a working adapter", async () => {
    const registry = new DatabaseRegistry(TEST_DIR);
    const adapter = await registry.create("testdb");
    await adapter.createTable({ name: "items", columns: [{ name: "label", type: "text" }] });
    const { id } = await adapter.insert("items", { label: "hello" });
    expect(id).toBe(1);
  });

  it("persists across instances via _metadata.sqlite", async () => {
    const r1 = new DatabaseRegistry(TEST_DIR);
    await r1.create("mydb");
    r1.close();

    const r2 = new DatabaseRegistry(TEST_DIR);
    expect(r2.list()).toContain("mydb");
    expect(r2.exists("mydb")).toBe(true);
  });

  it("cold start with no existing registry creates empty _metadata.sqlite", () => {
    const registry = new DatabaseRegistry(TEST_DIR);
    expect(registry.list()).toEqual([]);
    expect(existsSync(join(TEST_DIR, "_metadata.sqlite"))).toBe(true);
  });

  describe("metadata", () => {
    it("creates database with description", async () => {
      const registry = new DatabaseRegistry(TEST_DIR);
      await registry.create("meals", "Daily meal tracking");
      const meta = registry.getMetadata("meals");
      expect(meta.description).toBe("Daily meal tracking");
      expect(meta.notes).toBeNull();
    });

    it("creates database without description defaults to null", async () => {
      const registry = new DatabaseRegistry(TEST_DIR);
      await registry.create("meals");
      const meta = registry.getMetadata("meals");
      expect(meta.description).toBeNull();
      expect(meta.notes).toBeNull();
    });

    it("getMetadata throws for unknown database", () => {
      const registry = new DatabaseRegistry(TEST_DIR);
      expect(() => registry.getMetadata("missing")).toThrow(/does not exist/);
    });

    it("updateDescription sets description", async () => {
      const registry = new DatabaseRegistry(TEST_DIR);
      await registry.create("meals");
      registry.updateDescription("meals", "Calorie diary");
      const meta = registry.getMetadata("meals");
      expect(meta.description).toBe("Calorie diary");
    });

    it("updateDescription throws for unknown database", () => {
      const registry = new DatabaseRegistry(TEST_DIR);
      expect(() => registry.updateDescription("missing", "foo")).toThrow(/does not exist/);
    });

    it("updateNotes sets notes", async () => {
      const registry = new DatabaseRegistry(TEST_DIR);
      await registry.create("meals");
      registry.updateNotes("meals", "- meal_type: breakfast, lunch, dinner, snack");
      const meta = registry.getMetadata("meals");
      expect(meta.notes).toBe("- meal_type: breakfast, lunch, dinner, snack");
    });

    it("updateNotes replaces existing notes", async () => {
      const registry = new DatabaseRegistry(TEST_DIR);
      await registry.create("meals");
      registry.updateNotes("meals", "first version");
      registry.updateNotes("meals", "second version");
      const meta = registry.getMetadata("meals");
      expect(meta.notes).toBe("second version");
    });

    it("updateNotes throws for unknown database", () => {
      const registry = new DatabaseRegistry(TEST_DIR);
      expect(() => registry.updateNotes("missing", "foo")).toThrow(/does not exist/);
    });

    it("metadata persists across instances", async () => {
      const r1 = new DatabaseRegistry(TEST_DIR);
      await r1.create("meals", "Calorie diary");
      r1.updateNotes("meals", "Use integers for calories");
      r1.close();

      const r2 = new DatabaseRegistry(TEST_DIR);
      const meta = r2.getMetadata("meals");
      expect(meta.description).toBe("Calorie diary");
      expect(meta.notes).toBe("Use integers for calories");
    });
  });

  describe("migration from _registry.json", () => {
    it("migrates entries from JSON to SQLite", () => {
      mkdirSync(TEST_DIR, { recursive: true });
      const manifest = {
        databases: [
          { name: "calories", path: join(TEST_DIR, "calories.sqlite"), createdAt: "2024-01-01T00:00:00.000Z" },
          { name: "workouts", path: join(TEST_DIR, "workouts.sqlite"), createdAt: "2024-02-01T00:00:00.000Z" },
        ],
      };
      writeFileSync(join(TEST_DIR, "_registry.json"), JSON.stringify(manifest, null, 2), "utf-8");

      const registry = new DatabaseRegistry(TEST_DIR);
      expect(registry.list()).toContain("calories");
      expect(registry.list()).toContain("workouts");
      expect(registry.exists("calories")).toBe(true);
      expect(registry.exists("workouts")).toBe(true);
    });

    it("creates _registry.json.bak after migration", () => {
      mkdirSync(TEST_DIR, { recursive: true });
      const manifest = { databases: [{ name: "db1", path: join(TEST_DIR, "db1.sqlite"), createdAt: "2024-01-01T00:00:00.000Z" }] };
      writeFileSync(join(TEST_DIR, "_registry.json"), JSON.stringify(manifest), "utf-8");

      new DatabaseRegistry(TEST_DIR);
      expect(existsSync(join(TEST_DIR, "_registry.json.bak"))).toBe(true);
      expect(existsSync(join(TEST_DIR, "_registry.json"))).toBe(false);
    });

    it("does not re-migrate if _metadata.sqlite already exists", async () => {
      // First: create a registry with SQLite metadata
      const r1 = new DatabaseRegistry(TEST_DIR);
      await r1.create("existing");
      r1.close();

      // Place a JSON file (simulating leftover)
      const manifest = { databases: [{ name: "from-json", path: join(TEST_DIR, "from-json.sqlite"), createdAt: "2024-01-01T00:00:00.000Z" }] };
      writeFileSync(join(TEST_DIR, "_registry.json"), JSON.stringify(manifest), "utf-8");

      // Re-open — should NOT migrate because _metadata.sqlite already exists
      const r2 = new DatabaseRegistry(TEST_DIR);
      expect(r2.list()).toContain("existing");
      expect(r2.exists("from-json")).toBe(false);
    });
  });
});
