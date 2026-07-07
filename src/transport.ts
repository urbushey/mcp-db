import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JwtAccessTokenVerifier, UnauthorizedError, getUserDataDir } from "./auth.ts";
import type { Config } from "./config.ts";
import { createServer as createMcpServer } from "./server.ts";
import { handleWebRequest } from "./web-server.ts";

export type RunningTransport =
  | { kind: "stdio" }
  | { kind: "http"; server: ReturnType<typeof createServer>; url: string; close: () => Promise<void> };

function jsonError(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

function getBaseUrl(config: Config, req: IncomingMessage): string {
  return config.PUBLIC_BASE_URL ?? `http://${req.headers.host ?? `${config.MCP_HTTP_HOST}:${config.MCP_HTTP_PORT}`}`;
}

function getResourceMetadataUrl(config: Config, req: IncomingMessage): string {
  return new URL("/.well-known/oauth-protected-resource", getBaseUrl(config, req)).toString();
}

function writeUnauthorized(res: ServerResponse, config: Config, req: IncomingMessage, message: string) {
  jsonError(res, 401, message, {
    "WWW-Authenticate": `Bearer resource_metadata="${getResourceMetadataUrl(config, req)}"`,
  });
}

async function parseBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (raw.length === 0) return undefined;
  return JSON.parse(raw);
}

/**
 * /.well-known/oauth-protected-resource
 * When DCR is configured, advertises this server as the authorization server
 * so Claude can do Dynamic Client Registration against our /register endpoint.
 * When DCR is not configured, falls back to pointing at the upstream OAUTH_ISSUER.
 */
function writeProtectedResourceMetadata(res: ServerResponse, config: Config, req: IncomingMessage) {
  const base = getBaseUrl(config, req);
  // If DCR is configured, advertise ourselves as the AS so Claude can call /register.
  // The actual tokens are still issued by WorkOS (OAUTH_ISSUER).
  const authServers = config.DCR_CLIENT_ID
    ? [base]
    : config.OAUTH_ISSUER
    ? [config.OAUTH_ISSUER]
    : [];

  const body = {
    resource: config.OAUTH_AUDIENCE ?? base,
    authorization_servers: authServers,
    bearer_methods_supported: ["header"],
    resource_documentation: config.PUBLIC_BASE_URL ?? undefined,
  };

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * /.well-known/oauth-authorization-server
 * AS metadata (RFC 8414). Points Claude at WorkOS for the actual auth flow
 * but provides our /register endpoint for DCR.
 */
function writeAuthServerMetadata(res: ServerResponse, config: Config, req: IncomingMessage) {
  const base = getBaseUrl(config, req);
  const jwksUri = config.OAUTH_JWKS_URL
    ?? (config.OAUTH_ISSUER ? new URL("/.well-known/jwks.json", config.OAUTH_ISSUER).toString() : undefined);

  const body = {
    issuer: base,
    authorization_endpoint: config.OAUTH_AUTH_ENDPOINT,
    token_endpoint: config.OAUTH_TOKEN_ENDPOINT,
    jwks_uri: jwksUri,
    registration_endpoint: `${base}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    scopes_supported: ["openid", "profile", "email"],
  };

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * POST /register — Dynamic Client Registration (RFC 7591) proxy.
 * Returns pre-configured WorkOS client credentials so Claude can register
 * without WorkOS needing to support DCR natively.
 */
function writeDcrResponse(res: ServerResponse, config: Config) {
  if (!config.DCR_CLIENT_ID || !config.DCR_CLIENT_SECRET) {
    jsonError(res, 503, "Dynamic client registration is not configured on this server");
    return;
  }
  const body = {
    client_id: config.DCR_CLIENT_ID,
    client_secret: config.DCR_CLIENT_SECRET,
    redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
    client_id_issued_at: Math.floor(Date.now() / 1000),
  };
  res.writeHead(201, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function resolveUser(config: Config, req: IncomingMessage) {
  if (!config.AUTH_REQUIRED) return null;
  const verifier = new JwtAccessTokenVerifier(config);
  return verifier.verifyAuthorizationHeader(req.headers.authorization);
}

export async function startConfiguredTransport(config: Config): Promise<RunningTransport> {
  if (config.MCP_TRANSPORT === "stdio") {
    const { server } = await createMcpServer(config);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return { kind: "stdio" };
  }

  const httpServer = createServer(async (req, res) => {
    try {
      if (!req.url) {
        jsonError(res, 400, "Missing request URL");
        return;
      }

      const baseUrl = getBaseUrl(config, req);
      const url = new URL(req.url, baseUrl);

      // --- Health ---
      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, transport: config.MCP_TRANSPORT, authRequired: config.AUTH_REQUIRED }));
        return;
      }

      // --- OAuth discovery ---
      if (url.pathname === "/.well-known/oauth-protected-resource") {
        writeProtectedResourceMetadata(res, config, req);
        return;
      }
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        writeAuthServerMetadata(res, config, req);
        return;
      }

      // --- DCR ---
      if (url.pathname === "/register" && req.method === "POST") {
        writeDcrResponse(res, config);
        return;
      }

      // --- MCP endpoint ---
      if (url.pathname === config.MCP_HTTP_PATH) {
        if (!req.method || !["GET", "POST", "DELETE", "HEAD"].includes(req.method)) {
          jsonError(res, 405, "Method not allowed");
          return;
        }

        let dataDir = config.DATA_DIR;
        try {
          const user = await resolveUser(config, req);
          if (user) dataDir = getUserDataDir(config, user.subject);
        } catch (error) {
          if (error instanceof UnauthorizedError) {
            writeUnauthorized(res, config, req, error.message);
            return;
          }
          throw error;
        }

        const { server, registry } = await createMcpServer(config, { dataDir });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await server.connect(transport);

        if (req.method === "HEAD") {
          res.writeHead(200, { "MCP-Protocol-Version": "2025-06-18" });
          res.end();
          await transport.close();
          await server.close();
          registry.close();
          return;
        }

        const parsedBody = req.method === "POST" ? await parseBody(req) : undefined;
        await transport.handleRequest(req, res, parsedBody);

        res.on("close", () => {
          void transport.close();
          void server.close();
          registry.close();
        });
        return;
      }

      // --- Web app (auth, API, static) ---
      const handled = await handleWebRequest(req, res, url, config, baseUrl);
      if (handled) return;

      jsonError(res, 404, "Not found");
    } catch (error) {
      if (!res.headersSent) {
        jsonError(res, 500, error instanceof Error ? error.message : String(error));
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.MCP_HTTP_PORT, config.MCP_HTTP_HOST, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  const url = `http://${config.MCP_HTTP_HOST}:${config.MCP_HTTP_PORT}${config.MCP_HTTP_PATH}`;
  return {
    kind: "http",
    server: httpServer,
    url,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
