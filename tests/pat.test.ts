import { afterAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Config } from "../src/config.ts";
import { PAT_PREFIX, PatStore } from "../src/pat.ts";
import { startConfiguredTransport } from "../src/transport.ts";
import { UsageStore } from "../src/usage.ts";

const tempDirs: string[] = [];
const closers: Array<() => Promise<void>> = [];

afterAll(async () => {
  await Promise.allSettled(closers.map((close) => close()));
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "instant-db-pat-"));
  tempDirs.push(dir);
  return dir;
}

async function startJwksServer() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";

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
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const issuer = `http://127.0.0.1:${address.port}`;
  return {
    issuer,
    sign: (subject: string) =>
      new SignJWT({})
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(issuer)
        .setSubject(subject)
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(privateKey),
  };
}

async function startServer() {
  const baseDir = makeTempDir();
  const jwks = await startJwksServer();
  const config: Config = {
    DATA_DIR: baseDir,
    LOG_LEVEL: "verbose",
    LOG_PATH: join(baseDir, "mcp.log"),
    MCP_TRANSPORT: "http",
    MCP_HTTP_HOST: "127.0.0.1",
    MCP_HTTP_PORT: 0,
    MCP_HTTP_PATH: "/mcp",
    AUTH_REQUIRED: true,
    USAGE_ENFORCE: false,
    OAUTH_ISSUER: jwks.issuer,
    OAUTH_JWKS_URL: `${jwks.issuer}/.well-known/jwks.json`,
    PUBLIC_BASE_URL: "https://mcp.example.test",
    WEB_DIST_DIR: "./web/dist",
  };
  const running = await startConfiguredTransport(config);
  if (running.kind !== "http") throw new Error("Expected HTTP transport");
  closers.push(running.close);
  const address = running.server.address();
  if (!address || typeof address === "string") throw new Error("Missing bound address");
  return { config, jwks, url: `http://127.0.0.1:${address.port}/mcp` };
}

async function connect(url: string, token: string) {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "pat-test", version: "0.0.1" });
  await client.connect(transport);
  return client;
}

function listToolsStatus(url: string, token: string) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  }).then((r) => r.status);
}

describe("PatStore", () => {
  it("mints tokens with a recognizable prefix", () => {
    const store = new PatStore(makeTempDir());
    const { token } = store.create({ subject: "user-1", name: "pi" });
    store.close();
    expect(token.startsWith(PAT_PREFIX)).toBe(true);
  });

  it("stores only a sha256 hash of the token, never the plaintext", () => {
    const dir = makeTempDir();
    const store = new PatStore(dir);
    const { token } = store.create({ subject: "user-1", name: "pi" });
    store.close();

    const db = new Database(join(dir, "_accounts.sqlite"), { readonly: true });
    const dump = JSON.stringify(db.query("SELECT * FROM personal_access_tokens").all());
    db.close();
    expect(dump).not.toContain(token);
    expect(dump).toContain(new Bun.CryptoHasher("sha256").update(token).digest("hex"));
  });

  it("resolves a valid token to its subject and records last use", () => {
    const store = new PatStore(makeTempDir());
    const { token, id } = store.create({ subject: "user-1", name: "pi" });
    expect(store.verify(token)?.subject).toBe("user-1");
    expect(store.list("user-1").find((t) => t.id === id)?.lastUsedAt).toBeNumber();
    store.close();
  });

  it("rejects revoked, expired and unknown tokens", () => {
    const store = new PatStore(makeTempDir());
    const revoked = store.create({ subject: "user-1", name: "old" });
    store.revoke("user-1", revoked.id);
    const expired = store.create({ subject: "user-1", name: "short", expiresAt: Date.now() - 1000 });

    expect(store.verify(revoked.token)).toBeNull();
    expect(store.verify(expired.token)).toBeNull();
    expect(store.verify(`${PAT_PREFIX}nope`)).toBeNull();
    store.close();
  });

  it("only lets the owner revoke a token", () => {
    const store = new PatStore(makeTempDir());
    const { token, id } = store.create({ subject: "user-1", name: "pi" });
    expect(store.revoke("someone-else", id)).toBe(false);
    expect(store.verify(token)?.subject).toBe("user-1");
    store.close();
  });
});

describe("PAT auth over HTTP", () => {
  it("authenticates a PAT as the owning user and sees the same databases as OAuth", async () => {
    const { config, jwks, url } = await startServer();

    const oauth = await connect(url, await jwks.sign("user-abc"));
    const created = await oauth.callTool({
      name: "create_database",
      arguments: { database: "health", tables: [{ name: "meals", columns: [{ name: "food", type: "text" }] }] },
    });
    expect(created.isError).not.toBe(true);
    await oauth.close();

    const store = new PatStore(config.DATA_DIR);
    const { token } = store.create({ subject: "user-abc", name: "labmind-pi" });
    store.close();

    const headless = await connect(url, token);
    const result = await headless.callTool({ name: "list_databases", arguments: {} });
    await headless.close();

    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("health");

    // Each PAT call is metered against the owning user.
    const usage = new UsageStore(config.DATA_DIR);
    expect(usage.toolCallsOn("user-abc")).toBe(2);
    usage.close();
  });

  it("returns 401 for revoked and expired PATs", async () => {
    const { config, url } = await startServer();
    const store = new PatStore(config.DATA_DIR);
    const revoked = store.create({ subject: "user-abc", name: "old" });
    store.revoke("user-abc", revoked.id);
    const expired = store.create({ subject: "user-abc", name: "short", expiresAt: Date.now() - 1000 });
    store.close();

    expect(await listToolsStatus(url, revoked.token)).toBe(401);
    expect(await listToolsStatus(url, expired.token)).toBe(401);
    expect(await listToolsStatus(url, `${PAT_PREFIX}garbage`)).toBe(401);
  });

  it("never writes the token to the log", async () => {
    const { config, url } = await startServer();
    const store = new PatStore(config.DATA_DIR);
    const { token } = store.create({ subject: "user-abc", name: "pi" });
    store.close();

    const client = await connect(url, token);
    await client.callTool({ name: "list_databases", arguments: {} });
    await client.close();

    expect(readFileSync(config.LOG_PATH, "utf-8")).not.toContain(token);
  });

  it("still accepts OAuth JWTs", async () => {
    const { jwks, url } = await startServer();
    expect(await listToolsStatus(url, await jwks.sign("user-abc"))).toBe(200);
  });
});
