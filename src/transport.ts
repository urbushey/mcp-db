import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JwtAccessTokenVerifier, UnauthorizedError, getUserDataDir } from "./auth.ts";
import type { Config } from "./config.ts";
import { createServer as createMcpServer } from "./server.ts";

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

function writeProtectedResourceMetadata(res: ServerResponse, config: Config, req: IncomingMessage) {
  const body = {
    resource: config.OAUTH_AUDIENCE ?? getBaseUrl(config, req),
    authorization_servers: config.OAUTH_ISSUER ? [config.OAUTH_ISSUER] : [],
    bearer_methods_supported: ["header"],
    resource_documentation: config.PUBLIC_BASE_URL ?? undefined,
  };

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function resolveUser(config: Config, req: IncomingMessage) {
  if (!config.AUTH_REQUIRED) {
    return null;
  }

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

      const url = new URL(req.url, getBaseUrl(config, req));

      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, transport: config.MCP_TRANSPORT, authRequired: config.AUTH_REQUIRED }));
        return;
      }

      if (url.pathname === "/.well-known/oauth-protected-resource") {
        writeProtectedResourceMetadata(res, config, req);
        return;
      }

      if (url.pathname !== config.MCP_HTTP_PATH) {
        jsonError(res, 404, "Not found");
        return;
      }

      if (!req.method || !["GET", "POST", "DELETE", "HEAD"].includes(req.method)) {
        jsonError(res, 405, "Method not allowed");
        return;
      }

      let dataDir = config.DATA_DIR;
      try {
        const user = await resolveUser(config, req);
        if (user) {
          dataDir = getUserDataDir(config, user.subject);
        }
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
