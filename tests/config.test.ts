import { describe, it, expect, beforeEach, afterEach } from "bun:test";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    for (const key of ["DATA_DIR", "LOG_LEVEL", "LOG_PATH", "MCP_TRANSPORT", "MCP_HTTP_HOST", "MCP_HTTP_PORT", "MCP_HTTP_PATH"]) {
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
    delete process.env["MCP_HTTP_HOST"];
    delete process.env["MCP_HTTP_PORT"];
    delete process.env["MCP_HTTP_PATH"];

    // Re-import to pick up env
    const { loadConfig } = await import("../src/config.ts");
    const config = loadConfig();
    expect(config.DATA_DIR).toBe("./data");
    expect(config.LOG_LEVEL).toBe("normal");
    expect(config.LOG_PATH).toBe("./logs/mcp.log");
    expect(config.MCP_TRANSPORT).toBe("stdio");
    expect(config.MCP_HTTP_HOST).toBe("127.0.0.1");
    expect(config.MCP_HTTP_PORT).toBe(3001);
    expect(config.MCP_HTTP_PATH).toBe("/mcp");
  });

  it("respects custom env vars", async () => {
    process.env["DATA_DIR"] = "/tmp/mydata";
    process.env["LOG_LEVEL"] = "verbose";
    process.env["LOG_PATH"] = "/tmp/my.log";
    process.env["MCP_TRANSPORT"] = "http";
    process.env["MCP_HTTP_HOST"] = "0.0.0.0";
    process.env["MCP_HTTP_PORT"] = "4010";
    process.env["MCP_HTTP_PATH"] = "custom-mcp";

    const { loadConfig } = await import("../src/config.ts");
    const config = loadConfig();
    expect(config.DATA_DIR).toBe("/tmp/mydata");
    expect(config.LOG_LEVEL).toBe("verbose");
    expect(config.LOG_PATH).toBe("/tmp/my.log");
    expect(config.MCP_TRANSPORT).toBe("http");
    expect(config.MCP_HTTP_HOST).toBe("0.0.0.0");
    expect(config.MCP_HTTP_PORT).toBe(4010);
    expect(config.MCP_HTTP_PATH).toBe("/custom-mcp");
  });
});
