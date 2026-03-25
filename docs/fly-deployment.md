# Fly.io deployment notes

This repo now has streamable HTTP transport, protected-resource metadata, and bearer-token validation hooks for remote MCP.

- Current entrypoint: `src/index.ts`
- HTTP transport path: `/mcp`
- Auth config: `AUTH_REQUIRED`, `OAUTH_ISSUER`, `OAUTH_AUDIENCE`, `PUBLIC_BASE_URL`
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
5. Set real auth env/secrets (`PUBLIC_BASE_URL`, `AUTH_REQUIRED`, `OAUTH_ISSUER`, `OAUTH_AUDIENCE`, and optionally `OAUTH_JWKS_URL`)
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
