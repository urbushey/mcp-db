# Fly.io deployment notes

This repo now has streamable HTTP transport, protected-resource metadata, and bearer-token validation hooks for remote MCP.

- Current entrypoint: `src/index.ts`
- HTTP transport path: `/mcp`
- Auth config: see [Required secrets](#required-secrets). The server refuses to start if any are missing.
- Deployment/verification ticket: **#12**

## What is already prepared

The repo now includes:

- `Dockerfile` for Bun-based container builds
- `.dockerignore` for smaller, cleaner image uploads
- `fly.toml.example` with HTTP service + `/mcp` health check enabled
- a persistent volume mounted at `/data` for SQLite files and logs

## Recommended Fly footprint for MVP

Assuming a single-user or low-traffic MVP:

- **Machine size:** `shared-cpu-1x`
- **Memory:** `256mb` to start
- **Region:** `ewr` (good default for east coast / NYC)
- **Volume:** `1gb` attached at `/data`
- **Scale:** 1 machine only until concurrency/auth work is clearer

Why:

- Bun + SQLite is lightweight
- SQLite wants persistent local disk, so a Fly volume is the practical default
- One machine avoids multi-writer surprises while remote support is still being built

## Current platform state checked during issue #12

- Fly token exists locally at `~/.config/labmind/secrets/fly-token`
- `flyctl` was **not installed** on the machine used for this task
- Fly API query for apps returned **no apps** visible to this token at task time

## Deploy sequence

1. Install `flyctl`
2. Create the app
3. Create the volume
4. Copy `fly.toml.example` to `fly.toml` and set the real app name
5. Set every secret in [Required secrets](#required-secrets)
6. Deploy

Example commands:

```bash
export FLY_API_TOKEN="$(cat ~/.config/labmind/secrets/fly-token)"
cp fly.toml.example fly.toml
# edit fly.toml app name
flyctl apps create <app-name>
flyctl volumes create instant_db_data --region ewr --size 1 --app <app-name>
flyctl deploy
```

## Remote verification path once HTTP transport exists

### 1) Cheap protocol smoke tests

These should pass before trying a real MCP client:

```bash
curl -I https://<app-name>.fly.dev/mcp
curl -X POST https://<app-name>.fly.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

Expected shape:

- `HEAD /mcp` returns success and the MCP protocol header
- `POST /mcp` returns a JSON-RPC response rather than a Fly proxy error / timeout

### 2) MCP Inspector

The most practical end-to-end harness is the MCP Inspector pointed at the deployed endpoint.

Example:

```bash
npx @modelcontextprotocol/inspector
```

Then connect using the deployed URL, expected path `/mcp`.

Use it to verify at least:

- initialize handshake succeeds
- tool list loads
- `list_databases` works
- creating a test database on Fly persists across reconnects

### 3) Persistence check

After a create/insert flow via the inspector:

- disconnect
- reconnect
- call `list_databases` and `describe_database`
- confirm the database still exists

That confirms the Fly volume path is actually working, not just in-memory execution.

## Important caveat

A green Fly deploy is still not the same thing as a working remote MCP server. Do not call the MVP done until the live app passes protocol smoke tests and a real remote client flow.

## Required secrets

With `MCP_TRANSPORT=http` and `AUTH_REQUIRED=true`, `loadConfig()` exits at startup unless all of these are set. Before that check existed, a deploy missing the last five served the landing page while `/auth/login`, `/api/me` and `/register` returned 503.

| Setting | Value | Where it comes from |
|---|---|---|
| `AUTH_REQUIRED` | `true` | — |
| `PUBLIC_BASE_URL` | `https://<your-domain>` | The URL users add to Claude. Changing it later breaks every existing connector. |
| `OAUTH_ISSUER` | `https://<authkit-domain>` | WorkOS → Authentication → AuthKit → domain |
| `OAUTH_AUTH_ENDPOINT` | `https://<authkit-domain>/oauth2/authorize` | `authorization_endpoint` in `https://<authkit-domain>/.well-known/oauth-authorization-server` |
| `OAUTH_TOKEN_ENDPOINT` | `https://<authkit-domain>/oauth2/token` | `token_endpoint` in the same document |
| `DCR_CLIENT_ID` | `client_01…` | WorkOS → Applications → your OAuth app. Not the environment client ID on the API Keys page. |
| `DCR_CLIENT_SECRET` | | Same OAuth app. WorkOS shows it once when created. |
| `SESSION_SECRET` | random | `openssl rand -base64 32`. Rotating it signs everyone out of the dashboard. |

Optional: `OAUTH_JWKS_URL` (defaults to `<OAUTH_ISSUER>/.well-known/jwks.json`; AuthKit uses `/oauth2/jwks`), `OAUTH_AUDIENCE` (leave unset for WorkOS, which puts the client ID in `aud`), `USAGE_ENFORCE`.

The OAuth app in WorkOS must allow both redirect URIs:

- `https://<your-domain>/auth/callback` (dashboard sign-in)
- `https://claude.ai/api/mcp/auth_callback` (Claude connector)

Set them in one command so the app restarts once, and keep a copy of every value in a password manager:

```bash
fly secrets set -a <app-name> \
  PUBLIC_BASE_URL=... OAUTH_ISSUER=... OAUTH_AUTH_ENDPOINT=... OAUTH_TOKEN_ENDPOINT=... \
  DCR_CLIENT_ID=... DCR_CLIENT_SECRET=... SESSION_SECRET="$(openssl rand -base64 32)"
```

Check after deploying:

```bash
curl -si https://<your-domain>/auth/login | head -1          # 302 to WorkOS
curl -si https://<your-domain>/api/me | head -1              # 401, not 503
curl -si -X POST https://<your-domain>/register | head -1    # 201
```
