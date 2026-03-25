import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Config } from "./config.ts";
import { createServer as createMcpServer } from "./server.ts";

export type RunningTransport =
  | { kind: "stdio" }
  | { kind: "http"; server: ReturnType<typeof createServer>; url: string; close: () => Promise<void> };

function jsonError(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
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

      const url = new URL(req.url, `http://${req.headers.host ?? `${config.MCP_HTTP_HOST}:${config.MCP_HTTP_PORT}`}`);

      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, transport: config.MCP_TRANSPORT }));
        return;
      }

      if (url.pathname !== config.MCP_HTTP_PATH) {
        jsonError(res, 404, "Not found");
        return;
      }

      if (!req.method || !["GET", "POST", "DELETE"].includes(req.method)) {
        jsonError(res, 405, "Method not allowed");
        return;
      }

      const { server } = await createMcpServer(config);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);

      const parsedBody = req.method === "POST" ? await parseBody(req) : undefined;
      await transport.handleRequest(req, res, parsedBody);

      res.on("close", () => {
        void transport.close();
        void server.close();
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
