/**
 * Web server: handles dashboard auth, internal API, and static file serving.
 * All non-MCP, non-well-known routes go through handleWebRequest().
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Database } from "bun:sqlite";
import { DatabaseRegistry } from "./db/registry.ts";
import { getUserDataDir } from "./auth.ts";
import type { Config } from "./config.ts";
import {
  getSessionFromRequest,
  createSession,
  buildSessionCookieHeader,
  buildClearCookieHeader,
  buildStateCookieHeader,
  buildClearStateCookieHeader,
  generateState,
  generateCodeVerifier,
  deriveCodeChallenge,
  getStateCookieFromRequest,
  exchangeCodeForTokens,
  extractJwtClaims,
} from "./web-auth.ts";

const CONTENT_TYPES: Record<string, string> = {
  html:  "text/html; charset=utf-8",
  js:    "application/javascript; charset=utf-8",
  mjs:   "application/javascript; charset=utf-8",
  css:   "text/css; charset=utf-8",
  svg:   "image/svg+xml",
  png:   "image/png",
  jpg:   "image/jpeg",
  jpeg:  "image/jpeg",
  ico:   "image/x-icon",
  json:  "application/json",
  woff2: "font/woff2",
  woff:  "font/woff",
  txt:   "text/plain; charset=utf-8",
};

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string, status = 302): void {
  res.writeHead(status, { location });
  res.end();
}

async function serveFile(res: ServerResponse, filePath: string, maxAge = 0): Promise<boolean> {
  if (!existsSync(filePath)) return false;
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const buffer = await Bun.file(filePath).arrayBuffer();
  const headers: Record<string, string> = { "content-type": contentType };
  if (maxAge > 0) headers["cache-control"] = `public, max-age=${maxAge}, immutable`;
  res.writeHead(200, headers);
  res.end(Buffer.from(buffer));
  return true;
}

// --- Auth handlers ---

function handleAuthLogin(res: ServerResponse, config: Config, baseUrl: string): void {
  if (!config.OAUTH_AUTH_ENDPOINT || !config.DCR_CLIENT_ID) {
    jsonResponse(res, 503, { error: "OAuth not configured" });
    return;
  }
  const state = generateState();
  const verifier = generateCodeVerifier();
  const challenge = deriveCodeChallenge(verifier);

  const authUrl = new URL(config.OAUTH_AUTH_ENDPOINT);
  authUrl.searchParams.set("client_id", config.DCR_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", `${baseUrl}/auth/callback`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid profile email");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  res.writeHead(302, {
    location: authUrl.toString(),
    "set-cookie": buildStateCookieHeader(state, verifier),
  });
  res.end();
}

async function handleAuthCallback(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  config: Config,
  baseUrl: string,
): Promise<void> {
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    redirect(res, `/?error=${encodeURIComponent(errorParam)}`);
    return;
  }
  if (!code || !returnedState) {
    redirect(res, "/?error=missing_params");
    return;
  }

  const stateCookie = getStateCookieFromRequest(req);
  if (!stateCookie || stateCookie.state !== returnedState) {
    redirect(res, "/?error=state_mismatch");
    return;
  }
  if (!config.OAUTH_TOKEN_ENDPOINT || !config.DCR_CLIENT_ID || !config.DCR_CLIENT_SECRET || !config.SESSION_SECRET) {
    jsonResponse(res, 503, { error: "OAuth not fully configured" });
    return;
  }

  const tokens = await exchangeCodeForTokens(
    code,
    stateCookie.verifier,
    `${baseUrl}/auth/callback`,
    config.OAUTH_TOKEN_ENDPOINT,
    config.DCR_CLIENT_ID,
    config.DCR_CLIENT_SECRET,
  );

  if (!tokens) {
    redirect(res, "/?error=token_exchange_failed");
    return;
  }

  const claims = extractJwtClaims(tokens.id_token ?? tokens.access_token);
  const sub = typeof claims?.sub === "string" ? claims.sub : null;
  const email = typeof claims?.email === "string" ? claims.email
    : typeof claims?.preferred_username === "string" ? claims.preferred_username
    : "user";
  const name = typeof claims?.name === "string" ? claims.name : undefined;

  if (!sub) {
    redirect(res, "/?error=no_subject");
    return;
  }

  const isProduction = process.env.NODE_ENV === "production";
  const sessionVal = createSession({ sub, email, name }, config.SESSION_SECRET);

  res.writeHead(302, {
    location: "/dashboard",
    "set-cookie": [buildSessionCookieHeader(sessionVal, isProduction), buildClearStateCookieHeader()],
  });
  res.end();
}

function handleAuthLogout(res: ServerResponse): void {
  res.writeHead(302, { location: "/", "set-cookie": buildClearCookieHeader() });
  res.end();
}

// --- API handlers ---

function requireSession(req: IncomingMessage, res: ServerResponse, config: Config) {
  if (!config.SESSION_SECRET) {
    jsonResponse(res, 503, { error: "Session not configured" });
    return null;
  }
  const session = getSessionFromRequest(req, config.SESSION_SECRET);
  if (!session) {
    jsonResponse(res, 401, { error: "Unauthorized" });
    return null;
  }
  return session;
}

function handleApiMe(req: IncomingMessage, res: ServerResponse, config: Config): void {
  const session = requireSession(req, res, config);
  if (!session) return;
  jsonResponse(res, 200, { sub: session.sub, email: session.email, name: session.name });
}

function handleApiDatabases(req: IncomingMessage, res: ServerResponse, config: Config): void {
  const session = requireSession(req, res, config);
  if (!session) return;

  const dataDir = getUserDataDir(config, session.sub);
  const registry = new DatabaseRegistry(dataDir);
  try {
    const names = registry.list();
    const databases = names.map((name) => {
      const meta = registry.getMetadata(name);
      const dbPath = join(dataDir, `${name}.sqlite`);
      let sizeBytes = 0;
      let tableCount = 0;
      if (existsSync(dbPath)) {
        try { sizeBytes = statSync(dbPath).size; } catch { /* ignore */ }
        try {
          const db = new Database(dbPath, { readonly: true });
          const row = db.query(
            "SELECT count(*) as n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
          ).get() as { n: number } | null;
          tableCount = row?.n ?? 0;
          db.close();
        } catch { /* ignore */ }
      }
      return { name, description: meta.description, tableCount, sizeBytes };
    });
    jsonResponse(res, 200, databases);
  } catch (err) {
    jsonResponse(res, 500, { error: "Failed to read databases" });
  } finally {
    registry.close();
  }
}

async function handleApiDatabaseTables(
  req: IncomingMessage,
  res: ServerResponse,
  dbName: string,
  config: Config,
): Promise<void> {
  const session = requireSession(req, res, config);
  if (!session) return;

  const dataDir = getUserDataDir(config, session.sub);
  const registry = new DatabaseRegistry(dataDir);
  try {
    if (!registry.exists(dbName)) {
      jsonResponse(res, 404, { error: "Database not found" });
      return;
    }
    const adapter = registry.get(dbName);
    const tables = await adapter.getTables();
    jsonResponse(res, 200, tables);
  } catch {
    jsonResponse(res, 500, { error: "Failed to read tables" });
  } finally {
    registry.close();
  }
}

// --- Static file serving ---

async function handleStatic(res: ServerResponse, urlPath: string, config: Config): Promise<boolean> {
  const distDir = config.WEB_DIST_DIR;

  // Hashed assets — long cache
  if (urlPath.startsWith("/assets/")) {
    const assetPath = join(distDir, urlPath);
    return serveFile(res, assetPath, 31_536_000);
  }

  // SPA routes — serve index.html (React handles client-side routing)
  if (urlPath === "/" || urlPath === "/dashboard") {
    const indexPath = join(distDir, "index.html");
    if (existsSync(indexPath)) return serveFile(res, indexPath, 0);
    // Dev fallback
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(devFallbackHtml());
    return true;
  }

  return false;
}

function devFallbackHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>mcp-db</title>
  <style>
    body{font-family:system-ui;background:#0f0f0f;color:#fff;display:flex;
         align-items:center;justify-content:center;min-height:100vh;margin:0}
    .msg{text-align:center}
    h1{font-size:1.5rem;margin-bottom:.5rem}
    p{color:#888;font-size:.9rem}
    code{background:#1a1a1a;padding:2px 6px;border-radius:4px}
  </style>
</head>
<body>
  <div class="msg">
    <h1>mcp-db web UI</h1>
    <p>Run <code>bun run build:web</code> then restart the server.</p>
  </div>
</body>
</html>`;
}

// --- Main dispatcher (called from transport.ts) ---

export async function handleWebRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  config: Config,
  baseUrl: string,
): Promise<boolean> {
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (path === "/auth/login"    && method === "GET") { handleAuthLogin(res, config, baseUrl); return true; }
  if (path === "/auth/callback" && method === "GET") { await handleAuthCallback(req, res, url, config, baseUrl); return true; }
  if (path === "/auth/logout"   && method === "GET") { handleAuthLogout(res); return true; }

  if (path === "/api/me"        && method === "GET") { handleApiMe(req, res, config); return true; }
  if (path === "/api/databases" && method === "GET") { handleApiDatabases(req, res, config); return true; }

  const tablesMatch = path.match(/^\/api\/databases\/([^/]+)\/tables$/);
  if (tablesMatch && method === "GET") {
    await handleApiDatabaseTables(req, res, decodeURIComponent(tablesMatch[1]!), config);
    return true;
  }

  return handleStatic(res, path, config);
}
