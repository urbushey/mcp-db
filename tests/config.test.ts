import { describe, it, expect, beforeEach, afterEach } from "bun:test";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    for (const key of ["DATA_DIR", "LOG_LEVEL", "LOG_PATH", "MCP_TRANSPORT"]) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it("returns defaults when env vars are not set", async () => {
    delete process.env["DATA_DIR"];
    delete process.env["LOG_LEVEL"];
    delete process.env["LOG_PATH"];
    delete process.env["MCP_TRANSPORT"];

    // Re-import to pick up env
    const { loadConfig } = await import("../src/config.ts");
    const config = loadConfig();
    expect(config.DATA_DIR).toBe("./data");
    expect(config.LOG_LEVEL).toBe("normal");
    expect(config.LOG_PATH).toBe("./logs/mcp.log");
    expect(config.MCP_TRANSPORT).toBe("stdio");
  });

  it("respects custom env vars", async () => {
    process.env["DATA_DIR"] = "/tmp/mydata";
    process.env["LOG_LEVEL"] = "verbose";
    process.env["LOG_PATH"] = "/tmp/my.log";

    const { loadConfig } = await import("../src/config.ts");
    const config = loadConfig();
    expect(config.DATA_DIR).toBe("/tmp/mydata");
    expect(config.LOG_LEVEL).toBe("verbose");
  });
});
