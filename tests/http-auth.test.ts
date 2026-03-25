import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getUserDataDir } from "../src/auth.ts";
import type { Config } from "../src/config.ts";
import { startConfiguredTransport, type RunningTransport } from "../src/transport.ts";

const tempDirs: string[] = [];
const servers: Array<{ close: () => Promise<void> }> = [];

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
    privateKey,
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

async function startTestTransport(config: Config): Promise<Extract<RunningTransport, { kind: "http" }>> {
  const running = await startConfiguredTransport(config);
  if (running.kind !== "http") {
    throw new Error("Expected HTTP transport");
  }
  servers.push({ close: running.close });
  return running;
}

afterAll(async () => {
  await Promise.allSettled(servers.map((server) => server.close()));
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("HTTP auth transport", () => {
  it("rejects unauthenticated MCP requests with a Bearer challenge", async () => {
    const baseDir = makeTempDir("instant-db-auth-");
    const { issuer } = await startJwksServer();
    const running = await startTestTransport({
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
    });

    const address = running.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Missing bound address");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata=\"https://mcp.example.test/.well-known/oauth-protected-resource\"");
  });

  it("serves protected resource metadata", async () => {
    const baseDir = makeTempDir("instant-db-protected-resource-");
    const { issuer } = await startJwksServer();
    const running = await startTestTransport({
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
    });

    const address = running.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Missing bound address");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/.well-known/oauth-protected-resource`);
    const metadata = await response.json();

    expect(response.status).toBe(200);
    expect(metadata.resource).toBe("https://mcp.example.test");
    expect(metadata.authorization_servers).toEqual([issuer]);
    expect(metadata.bearer_methods_supported).toEqual(["header"]);
  });

  it("scopes authenticated requests into a per-user data directory", async () => {
    const baseDir = makeTempDir("instant-db-user-scope-");
    const jwks = await startJwksServer();
    const config: Config = {
      DATA_DIR: baseDir,
      LOG_LEVEL: "off",
      LOG_PATH: join(baseDir, "mcp.log"),
      MCP_TRANSPORT: "http",
      MCP_HTTP_HOST: "127.0.0.1",
      MCP_HTTP_PORT: 0,
      MCP_HTTP_PATH: "/mcp",
      AUTH_REQUIRED: true,
      OAUTH_ISSUER: jwks.issuer,
      OAUTH_AUDIENCE: "https://mcp.example.test",
      OAUTH_JWKS_URL: `${jwks.issuer}/.well-known/jwks.json`,
      PUBLIC_BASE_URL: "https://mcp.example.test",
    };
    const running = await startTestTransport(config);

    const address = running.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Missing bound address");
    }

    const token = await jwks.sign("user-123", "https://mcp.example.test");
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
      requestInit: {
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    });
    const client = new Client({ name: "test-client", version: "0.0.1" });
    await client.connect(transport);

    const result = await client.callTool({
      name: "create_database",
      arguments: {
        database: "workouts",
        tables: [{ name: "sessions", columns: [{ name: "name", type: "text" }] }],
      },
    });

    await client.close();

    expect(result.isError).not.toBe(true);
    expect(Bun.file(join(getUserDataDir(config, "user-123"), "workouts.sqlite")).size).toBeGreaterThan(0);
  });
});
