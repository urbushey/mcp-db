import { describe, it, expect } from "bun:test";

describe("project setup", () => {
  it("imports MCP SDK without error", async () => {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    expect(McpServer).toBeDefined();
  });

  it("imports zod without error", async () => {
    const { z } = await import("zod");
    expect(z).toBeDefined();
  });

  it("imports better-sqlite3 without error", async () => {
    const Database = await import("better-sqlite3");
    expect(Database.default).toBeDefined();
  });
});
