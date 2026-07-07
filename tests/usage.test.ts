import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UsageStore, checkQuota, makeUsageHook, userStorageBytes, type UsageContext } from "../src/usage.ts";
import { Logger } from "../src/logger.ts";
import type { Config } from "../src/config.ts";
import { startConfiguredTransport, type RunningTransport } from "../src/transport.ts";

const tempDirs: string[] = [];
const servers: Array<{ close: () => Promise<void> }> = [];

function makeTempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.allSettled(servers.map((s) => s.close()));
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// --- Unit: UsageStore ---

describe("UsageStore", () => {
  it("increments tool calls per user per day", () => {
    const dir = makeTempDir("instant-db-usage-store-");
    const store = new UsageStore(dir);
    expect(store.toolCallsOn("u1")).toBe(0);
    store.recordToolCall("u1");
    store.recordToolCall("u1");
    store.recordToolCall("u2");
    expect(store.toolCallsOn("u1")).toBe(2);
    expect(store.toolCallsOn("u2")).toBe(1);
    store.recordToolCall("u1", "2020-01-01");
    expect(store.toolCallsOn("u1")).toBe(2);
    expect(store.toolCallsOn("u1", "2020-01-01")).toBe(1);
    store.close();
  });

  it("creates accounts on first use with a free plan", () => {
    const dir = makeTempDir("instant-db-usage-acct-");
    const store = new UsageStore(dir);
    expect(store.getPlan("newcomer")).toBe("free");
    store.recordToolCall("newcomer");
    expect(store.getPlan("newcomer")).toBe("free");
    store.close();
  });
});

// --- Unit: checkQuota ---

function ctxFor(store: UsageStore, userDataDir: string, limits: UsageContext["limits"]): UsageContext {
  return { store, userId: "u1", userDataDir, enforce: true, limits };
}

describe("checkQuota", () => {
  it("rejects tool calls past the daily cap", () => {
    const root = makeTempDir("instant-db-quota-calls-");
    const store = new UsageStore(root);
    const ctx = ctxFor(store, join(root, "u1"), { toolCallsPerDay: 2, storageBytes: 1e9, databases: 99 });
    expect(checkQuota(ctx, "query_records")).toBeNull();
    store.recordToolCall("u1");
    store.recordToolCall("u1");
    expect(checkQuota(ctx, "query_records")?.message).toContain("2 instant-db tool calls");
    store.close();
  });

  it("rejects create_database past the database cap, counting only user databases", () => {
    const root = makeTempDir("instant-db-quota-dbs-");
    const store = new UsageStore(root);
    const userDir = join(root, "u1");
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, "_metadata.sqlite"), "x"); // registry file — must not count
    writeFileSync(join(userDir, "a.sqlite"), "x");
    writeFileSync(join(userDir, "b.sqlite"), "x");
    const ctx = ctxFor(store, userDir, { toolCallsPerDay: 99, storageBytes: 1e9, databases: 2 });
    expect(checkQuota(ctx, "create_database")?.message).toContain("2 databases");
    expect(checkQuota(ctx, "insert_record")).toBeNull(); // cap is create-only
    store.close();
  });

  it("rejects growth tools past the storage cap but always allows reads", () => {
    const root = makeTempDir("instant-db-quota-storage-");
    const store = new UsageStore(root);
    const userDir = join(root, "u1");
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, "big.sqlite"), Buffer.alloc(2048));
    expect(userStorageBytes(userDir)).toBe(2048);
    const ctx = ctxFor(store, userDir, { toolCallsPerDay: 99, storageBytes: 1024, databases: 99 });
    expect(checkQuota(ctx, "insert_record")?.message).toContain("storage limit");
    expect(checkQuota(ctx, "execute_mutation")?.message).toContain("storage limit");
    expect(checkQuota(ctx, "query_records")).toBeNull();
    expect(checkQuota(ctx, "execute_query")).toBeNull();
    store.close();
  });
});

// --- Unit: Logger.wrap with a usage hook ---

describe("Logger.wrap metering", () => {
  it("meter-only mode records usage and never blocks", async () => {
    const root = makeTempDir("instant-db-wrap-meter-");
    const store = new UsageStore(root);
    const hook = makeUsageHook({
      store,
      userId: "u1",
      userDataDir: join(root, "u1"),
      enforce: false,
      limits: { toolCallsPerDay: 1, storageBytes: 1e9, databases: 99 },
    });
    const logger = new Logger({ LOG_LEVEL: "off", LOG_PATH: join(root, "mcp.log") }, hook);

    const first = await logger.wrap("query_records", {}, async () => "ran");
    expect(first).toBe("ran");
    expect(store.toolCallsOn("u1")).toBe(1);
    // Over the limit now — meter-only must still execute the tool.
    const second = await logger.wrap("query_records", {}, async () => "ran again");
    expect(second).toBe("ran again");
    expect(store.toolCallsOn("u1")).toBe(2);
    store.close();
  });

  it("enforce mode returns an MCP error result without running the tool", async () => {
    const root = makeTempDir("instant-db-wrap-enforce-");
    const store = new UsageStore(root);
    store.recordToolCall("u1");
    const hook = makeUsageHook({
      store,
      userId: "u1",
      userDataDir: join(root, "u1"),
      enforce: true,
      limits: { toolCallsPerDay: 1, storageBytes: 1e9, databases: 99 },
    });
    const logger = new Logger({ LOG_LEVEL: "off", LOG_PATH: join(root, "mcp.log") }, hook);

    let executed = false;
    const result = (await logger.wrap("query_records", {}, async () => {
      executed = true;
      return "ran";
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(executed).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("tool calls");
    expect(store.toolCallsOn("u1")).toBe(1); // rejected call is not recorded
    store.close();
  });
});

// --- Integration: metering over authenticated HTTP ---

async function startJwksServer() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";

  const server = createServer((req, res) => {
    if (req.url === "/.well-known/jwks.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind JWKS server");
  servers.push({ close: async () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))) });
  return {
    issuer: `http://127.0.0.1:${address.port}`,
    async sign(subject: string) {
      return new SignJWT({ scope: "mcp" })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(`http://127.0.0.1:${address.port}`)
        .setSubject(subject)
        .setAudience("https://mcp.example.test")
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(privateKey);
    },
  };
}

async function startHttp(config: Config) {
  const running = await startConfiguredTransport(config);
  if (running.kind !== "http") throw new Error("Expected HTTP transport");
  servers.push({ close: running.close });
  const address = running.server.address();
  if (!address || typeof address === "string") throw new Error("Missing bound address");
  return { port: address.port };
}

function httpConfig(baseDir: string, issuer: string, enforce: boolean): Config {
  return {
    DATA_DIR: baseDir,
    LOG_LEVEL: "off",
    LOG_PATH: join(baseDir, "mcp.log"),
    MCP_TRANSPORT: "http",
    MCP_HTTP_HOST: "127.0.0.1",
    MCP_HTTP_PORT: 0,
    MCP_HTTP_PATH: "/mcp",
    AUTH_REQUIRED: true,
    USAGE_ENFORCE: enforce,
    OAUTH_ISSUER: issuer,
    OAUTH_AUDIENCE: "https://mcp.example.test",
    OAUTH_JWKS_URL: `${issuer}/.well-known/jwks.json`,
    PUBLIC_BASE_URL: "https://mcp.example.test",
    WEB_DIST_DIR: "./web/dist",
  };
}

async function connectedClient(port: number, token: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(transport);
  return client;
}

function createDbArgs(name: string) {
  return {
    name: "create_database",
    arguments: { database: name, tables: [{ name: "t", columns: [{ name: "v", type: "text" as const }] }] },
  };
}

describe("usage metering over HTTP", () => {
  it("records every authenticated tool call in _accounts.sqlite", async () => {
    const baseDir = makeTempDir("instant-db-meter-http-");
    const jwks = await startJwksServer();
    const { port } = await startHttp(httpConfig(baseDir, jwks.issuer, false));
    const client = await connectedClient(port, await jwks.sign("meter-user"));

    await client.callTool(createDbArgs("one"));
    await client.callTool({ name: "list_databases", arguments: {} });
    await client.callTool({ name: "list_databases", arguments: {} });
    await client.close();

    const store = new UsageStore(baseDir);
    expect(store.toolCallsOn("meter-user")).toBe(3);
    expect(store.getPlan("meter-user")).toBe("free");
    store.close();
  });

  it("enforces the free-tier database cap when USAGE_ENFORCE=true", async () => {
    const baseDir = makeTempDir("instant-db-enforce-http-");
    const jwks = await startJwksServer();
    const { port } = await startHttp(httpConfig(baseDir, jwks.issuer, true));
    const client = await connectedClient(port, await jwks.sign("capped-user"));

    for (const name of ["db1", "db2", "db3"]) {
      const result = await client.callTool(createDbArgs(name));
      expect(result.isError).not.toBe(true);
    }
    const fourth = await client.callTool(createDbArgs("db4"));
    await client.close();

    expect(fourth.isError).toBe(true);
    const text = (fourth.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("3 databases");
    expect(text).toContain("https://mcp.example.test/dashboard");
  });
});
