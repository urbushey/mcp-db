# Remote MCP MVP Handoff Status

Last updated: 2026-03-27

This document is a practical handoff note for whoever finishes the hosted MVP.

## TL;DR

The repo and deployment are most of the way there.

What is done:
- stdio/local mode still exists and should remain the compatibility baseline
- streamable HTTP transport is implemented
- protected-resource metadata is implemented
- bearer-token verification hooks are implemented
- per-user storage scoping is implemented
- Fly app is live
- live remote endpoint has been smoke-tested successfully without auth
- WorkOS/AuthKit was chosen as the OAuth provider for MVP
- WorkOS tenant information now exists and CIMD + DCR were enabled in the dashboard

What is not done:
- the live Fly app is still running with `AUTH_REQUIRED=false`
- end-to-end hosted OAuth flow has not been verified
- local-mode regression was discussed repeatedly and must be checked again before calling MVP done

## Current live deployment

Fly app:
- `mcp-db-mvp-labmind`

Live endpoint:
- `https://mcp-db-mvp-labmind.fly.dev/mcp`

Current local-only deploy config file:
- `fly.toml` (intentionally not pushed)

Known current live env shape in `fly.toml`:
- `PUBLIC_BASE_URL=https://mcp-db-mvp-labmind.fly.dev`
- `AUTH_REQUIRED=false`
- `OAUTH_AUDIENCE=https://mcp-db-mvp-labmind.fly.dev/mcp`

## What has already been verified on Fly

These were verified against the live app:
- `HEAD /mcp` returns `MCP-Protocol-Version`
- `/health` returns healthy HTTP transport state
- initialize handshake works when the client sends the correct `Accept` header
- MCP SDK client can connect and list tools
- persistence works on the Fly volume (a database was created, reconnect happened, and the database still existed)

One smoke-test DB may exist remotely:
- `fly_smoke_db`

## Important implementation details already landed in GitHub

Merged work includes:
- remote transport foundation
- WorkOS/AuthKit provider decision docs
- Fly deployment scaffold
- remote auth + per-user HTTP scoping
- env boolean parsing fix (`AUTH_REQUIRED="false"` was incorrectly treated as truthy before the fix)
- architecture overview docs

If another agent needs the code entry points, start here:
- `src/config.ts`
- `src/transport.ts`
- `src/auth.ts`
- `src/server.ts`
- `tests/http-auth.test.ts`
- `docs/fly-deployment.md`
- `docs/decisions/0001-remote-mcp-oauth-provider.md`
- `docs/architecture.md`

## WorkOS / AuthKit state

The user created WorkOS credentials and placed them locally in:
- `~/.config/labmind/secrets/workos-mcp-db.env`

Important lesson:
- those env values were accidentally swapped once (`WORKOS_API_KEY` and `WORKOS_CLIENT_ID`); that was later corrected

Confirmed values/state from user interaction:
- AuthKit domain / issuer root: `https://healthy-moss-74-staging.authkit.app`
- CIMD: enabled
- DCR: enabled

The exact next thing to verify is whether the following URLs return the expected metadata and whether the token shape is usable for the current JWT/JWKS validation path:
- `https://healthy-moss-74-staging.authkit.app/.well-known/oauth-authorization-server`
- `https://healthy-moss-74-staging.authkit.app/.well-known/openid-configuration`

Look specifically for:
- `issuer`
- `jwks_uri`
- `registration_endpoint`
- `token_endpoint`
- `introspection_endpoint`

## Recommended next steps for the next agent

1. Read the WorkOS secrets from the local secret file, but do not echo them back into chat.
2. Fetch and inspect AuthKit metadata from the issuer domain above.
3. Confirm the exact issuer string and JWKS URI.
4. Update Fly secrets / config to turn auth on:
   - `AUTH_REQUIRED=true`
   - `OAUTH_ISSUER=<exact issuer>`
   - `OAUTH_AUDIENCE=https://mcp-db-mvp-labmind.fly.dev/mcp`
   - `OAUTH_JWKS_URL=<jwks_uri>` if needed
   - `PUBLIC_BASE_URL=https://mcp-db-mvp-labmind.fly.dev`
5. Redeploy Fly.
6. Verify the unauthenticated request now returns a proper `401` plus `WWW-Authenticate` challenge.
7. Verify `/.well-known/oauth-protected-resource` includes the WorkOS authorization server.
8. Run a real end-to-end hosted auth test if possible.
9. Re-test local stdio mode before declaring success.
10. Update issue state to reflect reality.

## Risks / uncertainties still open

- It was not yet proven that WorkOS-issued access tokens line up perfectly with the current local JWT/JWKS verifier assumptions.
- If the token format or claims are awkward, the service may need to switch to token introspection rather than pure JWKS validation for MVP correctness.
- The user explicitly cares that local mode still works, so do not claim success based only on hosted checks.

## Definition of done for handoff purposes

Do not call the MVP done until all of the following are true:
- hosted app reachable over HTTPS
- hosted app requires auth in production
- OAuth metadata / protected-resource flow works
- an authenticated hosted client can complete the flow successfully
- local stdio mode still works
- GitHub issues and repo docs reflect the actual final state
