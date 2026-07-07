import { createHmac, randomBytes, createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";

export type Session = {
  sub: string;
  email: string;
  name?: string;
  exp: number;
};

const SESSION_COOKIE = "mcp_session";
const STATE_COOKIE = "mcp_oauth_state";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// --- Session cookie ---

export function createSession(payload: Omit<Session, "exp">, secret: string): string {
  const session: Session = { ...payload, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const encoded = Buffer.from(JSON.stringify(session)).toString("base64url");
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifySession(cookie: string, secret: string): Session | null {
  const dotIdx = cookie.lastIndexOf(".");
  if (dotIdx === -1) return null;
  const encoded = cookie.slice(0, dotIdx);
  const sig = cookie.slice(dotIdx + 1);
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as Session;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(req: IncomingMessage, secret: string): Session | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const cookies = parseCookies(cookieHeader);
  const val = cookies[SESSION_COOKIE];
  if (!val) return null;
  return verifySession(val, secret);
}

export function buildSessionCookieHeader(value: string, isProduction: boolean): string {
  const flags = [
    `${SESSION_COOKIE}=${value}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (isProduction) flags.push("Secure");
  return flags.join("; ");
}

export function buildClearCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

// --- PKCE helpers ---

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function deriveCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// --- State / CSRF ---

export function generateState(): string {
  return randomBytes(16).toString("base64url");
}

export function buildStateCookieHeader(state: string, verifier: string): string {
  const value = Buffer.from(JSON.stringify({ state, verifier })).toString("base64url");
  return `${STATE_COOKIE}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=600`;
}

export function getStateCookieFromRequest(req: IncomingMessage): { state: string; verifier: string } | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const cookies = parseCookies(cookieHeader);
  const val = cookies[STATE_COOKIE];
  if (!val) return null;
  try {
    return JSON.parse(Buffer.from(val, "base64url").toString("utf-8")) as { state: string; verifier: string };
  } catch {
    return null;
  }
}

export function buildClearStateCookieHeader(): string {
  return `${STATE_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

// --- Utilities ---

function parseCookies(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    result[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return result;
}

// --- Token exchange ---

export async function exchangeCodeForTokens(
  code: string,
  verifier: string,
  redirectUri: string,
  tokenEndpoint: string,
  clientId: string,
  clientSecret: string,
): Promise<{ access_token: string; id_token?: string } | null> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: verifier,
  });

  const resp = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) return null;
  return resp.json() as Promise<{ access_token: string; id_token?: string }>;
}

// --- JWT claims extraction (no signature check — WorkOS already issued it) ---

export function extractJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}
