import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getUserDataDir } from "../src/auth.ts";
import { recordMcpSeen, readMcpLastSeen } from "../src/connection-status.ts";
import { createSession } from "../src/web-auth.ts";
import type { Config } from "../src/config.ts";
import { startConfiguredTransport, type RunningTransport } from "../src/transport.ts";

const tempDirs: string[] = [];
const servers: Array<{ close: () => Promise<void> }> = [];

const SESSION_SECRET = "test-session-secret";

function makeTempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

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
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind JWKS server");
  }

  servers.push({ close: async () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())) });

  return {
    issuer: `http://127.0.0.1:${address.port}`,
    async sign(subject: string, audience: string) {
      return new SignJWT({ scope: "mcp" })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(`http://127.0.0.1:${address.port}`)
        .setSubject(subject)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(privateKey);
    },
  };
}

function makeConfig(baseDir: string, issuer: string): Config {
  return {
    DATA_DIR: baseDir,
    LOG_LEVEL: "off",
    LOG_PATH: join(baseDir, "mcp.log"),
    MCP_TRANSPORT: "http",
    MCP_HTTP_HOST: "127.0.0.1",
    MCP_HTTP_PORT: 0,
    MCP_HTTP_PATH: "/mcp",
    AUTH_REQUIRED: true,
    OAUTH_ISSUER: issuer,
    OAUTH_AUDIENCE: "https://mcp.example.test",
    OAUTH_JWKS_URL: `${issuer}/.well-known/jwks.json`,
    PUBLIC_BASE_URL: "https://mcp.example.test",
    SESSION_SECRET,
    WEB_DIST_DIR: "./web/dist",
  };
}

async function startTestTransport(config: Config): Promise<Extract<RunningTransport, { kind: "http" }>> {
  const running = await startConfiguredTransport(config);
  if (running.kind !== "http") {
    throw new Error("Expected HTTP transport");
  }
  servers.push({ close: running.close });
  return running;
}

function portOf(running: Extract<RunningTransport, { kind: "http" }>): number {
  const address = running.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Missing bound address");
  }
  return address.port;
}

function sessionCookieFor(sub: string): string {
  return `mcp_session=${createSession({ sub, email: "test@example.test" }, SESSION_SECRET)}`;
}

afterAll(async () => {
  await Promise.allSettled(servers.map((server) => server.close()));
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("connection status tracking", () => {
  it("records and reads a last-seen timestamp", () => {
    const dir = makeTempDir("instant-db-lastseen-");
    const userDir = join(dir, "users", "abc");
    expect(readMcpLastSeen(userDir)).toBeNull();
    recordMcpSeen(userDir);
    const ts = readMcpLastSeen(userDir);
    expect(ts).not.toBeNull();
    expect(ts!).toBeGreaterThan(Date.now() - 5_000);
  });
});

describe("/api/status", () => {
  it("rejects requests without a session", async () => {
    const baseDir = makeTempDir("instant-db-status-noauth-");
    const { issuer } = await startJwksServer();
    const running = await startTestTransport(makeConfig(baseDir, issuer));

    const response = await fetch(`http://127.0.0.1:${portOf(running)}/api/status`);
    expect(response.status).toBe(401);
  });

  it("reports disconnected for a fresh user", async () => {
    const baseDir = makeTempDir("instant-db-status-fresh-");
    const { issuer } = await startJwksServer();
    const running = await startTestTransport(makeConfig(baseDir, issuer));

    const response = await fetch(`http://127.0.0.1:${portOf(running)}/api/status`, {
      headers: { cookie: sessionCookieFor("fresh-user") },
    });
    const status = await response.json() as { connected: boolean; lastSeen: number | null; dbCount: number };

    expect(response.status).toBe(200);
    expect(status.connected).toBe(false);
    expect(status.lastSeen).toBeNull();
    expect(status.dbCount).toBe(0);
  });

  it("flips to connected after the user's first authenticated MCP request", async () => {
    const baseDir = makeTempDir("instant-db-status-connect-");
    const jwks = await startJwksServer();
    const config = makeConfig(baseDir, jwks.issuer);
    const running = await startTestTransport(config);
    const port = portOf(running);

    const token = await jwks.sign("user-onboarding", "https://mcp.example.test");
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "test-client", version: "0.0.1" });
    await client.connect(transport);
    const result = await client.callTool({
      name: "create_database",
      arguments: {
        database: "meals",
        tables: [{ name: "entries", columns: [{ name: "food", type: "text" }] }],
      },
    });
    await client.close();
    expect(result.isError).not.toBe(true);

    // The MCP token's subject and the dashboard session's sub are the same user id.
    const response = await fetch(`http://127.0.0.1:${port}/api/status`, {
      headers: { cookie: sessionCookieFor("user-onboarding") },
    });
    const status = await response.json() as { connected: boolean; lastSeen: number | null; dbCount: number };

    expect(status.connected).toBe(true);
    expect(status.lastSeen).toBeGreaterThan(Date.now() - 60_000);
    expect(status.dbCount).toBe(1);
    expect(readMcpLastSeen(getUserDataDir(config, "user-onboarding"))).not.toBeNull();
  });
});
