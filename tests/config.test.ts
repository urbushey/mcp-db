import { describe, it, expect, afterEach } from "bun:test";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };
  const managedKeys = [
    "DATA_DIR",
    "LOG_LEVEL",
    "LOG_PATH",
    "MCP_TRANSPORT",
    "MCP_HTTP_HOST",
    "MCP_HTTP_PORT",
    "MCP_HTTP_PATH",
    "AUTH_REQUIRED",
    "OAUTH_ISSUER",
    "OAUTH_AUDIENCE",
    "OAUTH_JWKS_URL",
    "PUBLIC_BASE_URL",
  ];

  afterEach(() => {
    for (const key of managedKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it("returns defaults when env vars are not set", async () => {
    for (const key of managedKeys) {
      delete process.env[key];
    }

    const { loadConfig } = await import("../src/config.ts");
    const config = loadConfig();
    expect(config.DATA_DIR).toBe("./data");
    expect(config.LOG_LEVEL).toBe("normal");
    expect(config.LOG_PATH).toBe("./logs/mcp.log");
    expect(config.MCP_TRANSPORT).toBe("stdio");
    expect(config.MCP_HTTP_HOST).toBe("127.0.0.1");
    expect(config.MCP_HTTP_PORT).toBe(3001);
    expect(config.MCP_HTTP_PATH).toBe("/mcp");
    expect(config.AUTH_REQUIRED).toBe(false);
    expect(config.OAUTH_ISSUER).toBeUndefined();
    expect(config.OAUTH_AUDIENCE).toBeUndefined();
    expect(config.OAUTH_JWKS_URL).toBeUndefined();
    expect(config.PUBLIC_BASE_URL).toBeUndefined();
  });

  it("respects custom env vars", async () => {
    process.env["DATA_DIR"] = "/tmp/mydata";
    process.env["LOG_LEVEL"] = "verbose";
    process.env["LOG_PATH"] = "/tmp/my.log";
    process.env["MCP_TRANSPORT"] = "http";
    process.env["MCP_HTTP_HOST"] = "0.0.0.0";
    process.env["MCP_HTTP_PORT"] = "4010";
    process.env["MCP_HTTP_PATH"] = "custom-mcp";
    process.env["AUTH_REQUIRED"] = "true";
    process.env["OAUTH_ISSUER"] = "https://auth.example.com";
    process.env["OAUTH_AUDIENCE"] = "https://mcp.example.com";
    process.env["OAUTH_JWKS_URL"] = "https://auth.example.com/jwks";
    process.env["PUBLIC_BASE_URL"] = "https://mcp.example.com";

    const { loadConfig } = await import("../src/config.ts");
    const config = loadConfig();
    expect(config.DATA_DIR).toBe("/tmp/mydata");
    expect(config.LOG_LEVEL).toBe("verbose");
    expect(config.LOG_PATH).toBe("/tmp/my.log");
    expect(config.MCP_TRANSPORT).toBe("http");
    expect(config.MCP_HTTP_HOST).toBe("0.0.0.0");
    expect(config.MCP_HTTP_PORT).toBe(4010);
    expect(config.MCP_HTTP_PATH).toBe("/custom-mcp");
    expect(config.AUTH_REQUIRED).toBe(true);
    expect(config.OAUTH_ISSUER).toBe("https://auth.example.com");
    expect(config.OAUTH_AUDIENCE).toBe("https://mcp.example.com");
    expect(config.OAUTH_JWKS_URL).toBe("https://auth.example.com/jwks");
    expect(config.PUBLIC_BASE_URL).toBe("https://mcp.example.com");
  });

  it("parses false-like AUTH_REQUIRED values correctly", async () => {
    process.env["AUTH_REQUIRED"] = "false";

    const { loadConfig } = await import("../src/config.ts");
    const config = loadConfig();
    expect(config.AUTH_REQUIRED).toBe(false);
  });

});
