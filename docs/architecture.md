# Architecture Overview

instant-db runs in two shapes that share the same MCP tool layer:

1. **Local / stdio** for Claude Desktop or Claude Code on your own machine. No auth, one data directory.
2. **Hosted / HTTP** on Fly.io. Users sign in through WorkOS, and each user gets a private data directory.

The tool handlers and database layer are identical in both. Only the transport and auth layers change.

## The pieces

| Piece | What it does |
|---|---|
| **WorkOS / AuthKit** | Owns user accounts and login. Shows the sign-in page, checks credentials, issues signed tokens (JWTs), and publishes the public keys that verify them. instant-db never sees a password. |
| **Fly.io app** | Runs the Bun server: `/mcp`, the dashboard, the OAuth discovery endpoints. One machine, one volume. |
| **Fly secrets** | WorkOS settings and the session signing key. See [Settings](#settings). |
| **Fly volume `/data`** | All user data, plus the control-plane database `_accounts.sqlite`. |
| **Claude** (web, desktop, mobile, Code) | The MCP client. Runs the OAuth flow with WorkOS and then calls `/mcp` with the token it got. |

The one fact that ties them together is the **WorkOS user id** (`sub`, e.g. `user_01…`). Every way of signing in ends with a `sub`, and `sub` decides whose data a request can touch:

```text
data/users/<sha256(sub)>/
```

## Code map

| File | Responsibility |
|---|---|
| `src/index.ts` | Loads config, starts the transport |
| `src/config.ts` | Parses env vars. In hosted mode, refuses to start if any sign-in setting is missing. |
| `src/transport.ts` | stdio or HTTP. In HTTP mode it routes `/mcp`, `/health`, `/.well-known/*`, `/register`, and hands everything else to the web server. Resolves the caller to a `sub`. |
| `src/auth.ts` | Verifies WorkOS JWTs against the JWKS. Maps `sub` to a data directory. |
| `src/pat.ts` | Personal access tokens: mint, verify, revoke. Stores hashes only. |
| `src/web-server.ts`, `src/web-auth.ts` | Dashboard sign-in (`/auth/*`), session cookie, `/api/*`, static files |
| `src/usage.ts` | Usage meter and plan limits, stored in `_accounts.sqlite` |
| `src/logger.ts` | Wraps every tool call: quota check before, usage record after, JSONL log |
| `src/server.ts` | Builds the MCP server, the registry, and the logger for one data directory |
| `src/tools/*` | The MCP tools (`list_databases`, `create_database`, `insert_record`, `query_records`, …) |
| `src/db/*` | `DatabaseRegistry` (`_metadata.sqlite`) and the SQLite adapter, one file per database |
| `web/app.tsx` | Landing page, onboarding, dashboard |

## Three ways a request gets a user

### 1. Claude connector (OAuth)

How claude.ai, Claude Desktop, mobile and Code connect. Claude does the OAuth work; instant-db mostly points it at WorkOS and checks the result.

```text
 Claude                      instant-db (Fly)                  WorkOS / AuthKit
   |                               |                                  |
   |-- POST /mcp (no token) ------>|                                  |
   |<-- 401 + resource_metadata ---|                                  |
   |-- GET /.well-known/oauth-protected-resource -->|                 |
   |<-- authorization_servers: [instant-db] --------|                 |
   |-- GET /.well-known/oauth-authorization-server ->|                |
   |<-- authorize/token = WorkOS, register = /register               |
   |-- POST /register ------------>|                                  |
   |<-- shared client_id + secret -|                                  |
   |                               |                                  |
   |-- send user to authorize ---------------------------------------->|
   |                                        user signs in             |
   |<-- redirect to claude.ai/api/mcp/auth_callback?code=… -----------|
   |-- exchange code for access token -------------------------------->|
   |<-- JWT (sub, iss, aud=client_id) ---------------------------------|
   |                               |                                  |
   |-- POST /mcp, Bearer <JWT> --->|                                  |
   |                               |-- fetch JWKS (cached) ---------->|
   |                               |   verify signature + issuer      |
   |                               |   sub -> data/users/<hash>/      |
   |<-- tool result ---------------|                                  |
```

Notes:

- `/register` is a small proxy, not real Dynamic Client Registration. It hands every caller the same pre-registered WorkOS client and only allows Claude's redirect URI. When `DCR_CLIENT_ID` is unset, the protected-resource metadata points Claude straight at AuthKit, which has its own registration endpoint.
- WorkOS sets `aud` to the client ID, not the resource URL. Leave `OAUTH_AUDIENCE` unset or every token fails verification.
- instant-db never stores Claude's access token; it verifies it on every request. The authorization-server metadata only advertises the `authorization_code` grant, so whether Claude can refresh without a new sign-in is unverified.

### 2. Dashboard (session cookie)

The web app at the server root. The server does the OAuth code exchange itself, then switches to its own cookie.

```text
 Browser                     instant-db (Fly)                  WorkOS / AuthKit
   |-- GET /auth/login ----------->|                                  |
   |<-- 302 to authorize, state + PKCE cookie                         |
   |-- sign in ------------------------------------------------------>|
   |<-- 302 /auth/callback?code=… ------------------------------------|
   |-- GET /auth/callback -------->|                                  |
   |                               |-- code + client secret --------->|
   |                               |<-- id_token (sub, email) --------|
   |<-- 302 /dashboard, Set-Cookie: mcp_session (signed, 7 days)      |
   |-- GET /api/me, /api/status, /api/databases (cookie) -->|         |
```

- The cookie is HMAC-signed with `SESSION_SECRET`. WorkOS isn't involved again until it expires. Rotating `SESSION_SECRET` signs everyone out.
- The dashboard reads the same `data/users/<hash>/` directory the MCP tools write to, which is how it shows a user's databases and whether Claude has connected.

### 3. Personal access token (headless agents)

For agents that can't do a browser login (OpenClaw, Muse). WorkOS isn't involved.

```text
 Agent                       instant-db (Fly)
   |-- POST /mcp, Bearer mcpdb_pat_… -->|
   |                                    |  sha256(token) -> _accounts.sqlite
   |                                    |  -> sub (if not revoked or expired)
   |                                    |  sub -> data/users/<hash>/
   |<-- tool result --------------------|
```

- Tokens are minted with `scripts/pat.ts` (CLI only for now). The plaintext is shown once; only the hash is stored.
- A token has the same access as its owner's OAuth session. Calls count against the owner's usage.

## Inside a `/mcp` request

Whichever path produced the `sub`, the rest is the same:

1. `transport.ts` maps `sub` to `data/users/<hash>/`.
2. `server.ts` builds an MCP server, a `DatabaseRegistry` and a `Logger` for that directory only.
3. The usage hook (`usage.ts`) is attached to the logger.
4. Each tool call goes through `logger.wrap()`: quota check, then the tool, then a usage record. With `USAGE_ENFORCE=false` (the default), an over-limit call is logged as `quota_would_reject` and still runs.
5. Tool handlers read and write SQLite files only inside that directory.

A server instance never holds more than one user's directory, so one user can't reach another's data through the tool layer.

Local stdio mode skips steps 1 and 3: no `sub`, no metering, and the data directory is `DATA_DIR` itself.

## What's stored where

| Place | Contents |
|---|---|
| WorkOS | User accounts, credentials, login sessions |
| Fly secrets | Settings listed below |
| `/data/users/<hash>/` | One user's databases (`*.sqlite`), their `_metadata.sqlite`, a last-seen marker |
| `/data/_accounts.sqlite` | `accounts` (plan), `usage_daily` (tool calls per day), `personal_access_tokens` (hashes) |
| `/data/logs/mcp.log` | JSONL log of tool calls |
| Claude | Its own OAuth tokens for the connector |

Nothing on the volume is backed up yet. See `SPECS/external-launch-readiness.md`, stage 2.

## Settings

Hosted mode (`MCP_TRANSPORT=http`, `AUTH_REQUIRED=true`) needs all of these, and `src/config.ts` refuses to start without them:

| Setting | Used by |
|---|---|
| `PUBLIC_BASE_URL` | Discovery documents, redirect URIs, the URL users give Claude |
| `OAUTH_ISSUER` | Verifying every JWT: the WorkOS domain that signs them |
| `OAUTH_AUTH_ENDPOINT` | Dashboard sign-in redirect; advertised to Claude |
| `OAUTH_TOKEN_ENDPOINT` | Dashboard code exchange; advertised to Claude |
| `DCR_CLIENT_ID`, `DCR_CLIENT_SECRET` | Dashboard code exchange and the `/register` proxy |
| `SESSION_SECRET` | Signing dashboard cookies (not a WorkOS value) |

Where each value comes from: `docs/fly-deployment.md`, "Required secrets".

## Files to read next

- `docs/fly-deployment.md`: deploying and the required secrets
- `docs/decisions/0001-remote-mcp-oauth-provider.md`: why WorkOS/AuthKit
- `SPECS/remote-hosted-service.md`: the hosted-service plan
- `SPECS/usage-metering-billing.md`: metering and billing
- `SPECS/external-launch-readiness.md`: what's left before external users
