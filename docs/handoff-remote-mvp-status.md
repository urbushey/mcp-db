# Remote MCP MVP — Complete

Last updated: 2026-03-30

## Status: ✅ Done

The remote OAuth MVP is fully working. Claude Code connects to the live endpoint, authenticates via WorkOS/AuthKit, and can use all MCP tools.

## Live deployment

- Fly app: `mcp-db-mvp-labmind`
- Live endpoint: `https://mcp-db-mvp-labmind.fly.dev/mcp`
- Auth: required (`AUTH_REQUIRED=true`)
- Provider: WorkOS/AuthKit (`https://healthy-moss-74-staging.authkit.app`)

## Fly secrets in use

- `AUTH_REQUIRED=true`
- `OAUTH_ISSUER=https://healthy-moss-74-staging.authkit.app`
- `OAUTH_JWKS_URL=https://healthy-moss-74-staging.authkit.app/oauth2/jwks`
- `PUBLIC_BASE_URL=https://mcp-db-mvp-labmind.fly.dev`
- `OAUTH_AUDIENCE` — intentionally NOT set (see lessons below)

## Key lesson: WorkOS audience claim

WorkOS/AuthKit issues access tokens with the DCR `client_id` as the `aud` claim, not the resource URL. Do not set `OAUTH_AUDIENCE` when using WorkOS — `jose`'s `jwtVerify` enforces it strictly and will reject all tokens.

The app's `src/auth.ts` already handles this: audience validation is skipped when `OAUTH_AUDIENCE` is not set.

## What was verified

- Unauthenticated requests return `401` with `WWW-Authenticate` challenge
- `/.well-known/oauth-protected-resource` advertises WorkOS as the authorization server
- Claude Code connects, triggers OAuth flow, logs in via WorkOS, and receives a valid token
- Authenticated requests pass token verification (issuer + JWKS signature check)
- Per-user storage scoping works
- Local stdio mode still works
- Persistence on Fly volume works

## Repo state

- `main` branch is clean and up to date
- No open PRs or issues
- No stale branches
