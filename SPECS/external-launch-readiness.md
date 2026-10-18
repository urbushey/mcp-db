# External Launch Readiness

## Status
Draft — October 2026

## Why this, why now

instant-db is deployed at `mcp-db-mvp-labmind.fly.dev`, but nobody outside can use it. On 2026-10-01 the sign-in button led to "Failed to load user". Checking the public endpoints showed why:

| Endpoint | Response | Cause |
|---|---|---|
| `GET /auth/login` | `503 {"error":"OAuth not configured"}` | `OAUTH_AUTH_ENDPOINT` / `DCR_CLIENT_ID` unset |
| `GET /api/me` | `503 {"error":"Session not configured"}` | `SESSION_SECRET` unset |
| `POST /register` | `503` | `DCR_CLIENT_ID` / `DCR_CLIENT_SECRET` unset |
| `/.well-known/oauth-authorization-server` | no `authorization_endpoint` or `token_endpoint` | `OAUTH_AUTH_ENDPOINT` / `OAUTH_TOKEN_ENDPOINT` unset |

`docs/fly-deployment.md` only lists `PUBLIC_BASE_URL`, `AUTH_REQUIRED`, `OAUTH_ISSUER` and `OAUTH_AUDIENCE`. The dashboard login and DCR proxy came later, and their settings were never added to the deploy steps.

Recovering the missing values also failed. Four client IDs from the WorkOS dashboard all got `invalid_client: Application not found` from `healthy-moss-74-staging.authkit.app`. No copy of the values exists in a local `.env`, on `labmind-pi`, or anywhere else checked. Nobody currently knows who owns the AuthKit environment the server points at.

So the gap between "deployed" and "usable by a stranger" is wider than the auth bug. This spec lists everything between here and the first external user, in the order it has to happen.

## Definition of done

A person with no connection to the project can:

1. Find the product and read how it works and what happens to their data.
2. Sign up with no help from us.
3. Add instant-db to Claude (web, desktop, mobile, Code) by following published instructions.
4. Create a database, use it across sessions, and trust that it won't be lost.
5. Give an agent of their own access without anyone running `fly ssh`.
6. Export everything and delete their account.

And when something breaks, we hear about it before they tell us.

## Current state

What exists, as of `main` at `8107057`:

- Streamable HTTP transport, per-user data dirs keyed by the WorkOS `sub` (`src/auth.ts`, `src/transport.ts`)
- WorkOS JWT verification via JWKS; DCR proxy at `/register` with a hard-coded Claude redirect URI
- Dashboard: signed session cookie, onboarding page, database list (`src/web-server.ts`, `web/app.tsx`)
- Usage metering, enforcement off (`USAGE_ENFORCE=false`, #25)
- Personal access tokens, CLI only (`scripts/pat.ts`, #27)
- Mintlify docs in `docs/` covering local stdio setup only, with placeholder `your-username` links, not deployed
- One Fly machine, one volume (`instant_db_data`), `min_machines_running = 0`

What doesn't:

- Working sign-in in production
- Backups
- Data export, account deletion
- CI (no `.github/workflows`); `tsc` reports 23 errors on `main`
- Monitoring or alerting
- Rate limiting
- Self-serve tokens
- Privacy policy, terms, contact
- A real domain

## Non-goals (this pass)

- Shared accounts, teams, invites. Each login owns one private data dir. "Join an existing account" isn't possible today, and building it is a separate spec.
- Billing. Covered by `SPECS/usage-metering-billing.md` Phase 2. Launch is free-tier only.
- Database import (#20).
- Multi-region, Postgres, horizontal scale.

## Plan

Each stage depends on the ones above it. Stages 1–3 and the CI and monitoring parts of stage 4 are the launch gate. The rest can follow.

### Stage 1 — Sign-in works

**Blocker for everything else.** Most of it is WorkOS configuration only the account owner can do.

1. **Establish ownership of the AuthKit environment.** Find which WorkOS account and environment owns `healthy-moss-74-staging.authkit.app` (Authentication → AuthKit → domain). If none of yours does, create a new environment.
2. **Move to a Production WorkOS environment.** External users shouldn't sign in through a staging AuthKit domain. A production environment gets its own domain, so `OAUTH_ISSUER` changes. Any existing Claude connector sessions will need to reconnect, which is fine before launch.
3. **Create the OAuth application** in that environment with both redirect URIs:
   - `https://<domain>/auth/callback` (dashboard login)
   - `https://claude.ai/api/mcp/auth_callback` (Claude connector via DCR proxy)
4. **Set every secret on Fly:** `OAUTH_ISSUER`, `OAUTH_AUTH_ENDPOINT`, `OAUTH_TOKEN_ENDPOINT`, `DCR_CLIENT_ID`, `DCR_CLIENT_SECRET`, `SESSION_SECRET`. Keep a copy in a password manager. Today Fly and WorkOS are the only places these could live, and Fly turned out to have none of them.
5. **Fail loudly on missing config.** When `AUTH_REQUIRED=true` and `MCP_TRANSPORT=http`, the server should refuse to start if any of the dashboard or DCR settings are missing. `superRefine` in `src/config.ts` already does this for `OAUTH_ISSUER` and `PUBLIC_BASE_URL`; extend it. A deploy with half the config should fail the health check, not serve 503s to users.
6. **Show the real error in the dashboard.** `web/app.tsx:372` turns any non-401 from `/api/me` into "Failed to load user". Surface the server's message.
7. **Document the full setting list** in `docs/fly-deployment.md`, with where each value comes from in WorkOS.
8. **End-to-end test with a brand-new account.** Sign up, then dashboard, then add the connector in claude.ai, Claude Desktop, Claude mobile and Claude Code, then create a database and use it in a second session.

**Note on DCR.** `writeDcrResponse` hands every caller the same pre-registered client ID and secret, and only allows Claude's redirect URI. That's fine for Claude-only launch. AuthKit advertises its own `registration_endpoint` and `client_id_metadata_document_supported: true`. Moving to native AuthKit DCR would remove the shared secret and let non-Claude MCP clients use OAuth. Track that as follow-up, not as part of the launch gate.

### Stage 2 — Data is safe

1. **Backups.** User data is SQLite files on one Fly volume with no backup. Options:
   - **Litestream to R2 or S3** (recommended). Continuous, point-in-time restore, cheap. Needs one process per database file or a wrapper, since each user has several `.sqlite` files.
   - **Fly volume snapshots.** Daily by default with 5-day retention. Zero work, but a whole-volume restore only, and snapshots live in the same provider.
   - Start with confirmed volume snapshots on day one and add Litestream before the user count makes a whole-volume rollback unacceptable.
2. **Test a restore.** Restore into a scratch app and confirm a user's databases open and match. A backup nobody has restored is a guess.
3. **Data export.** A dashboard "Download" per database that serves the raw `.sqlite` file, as promised in `SPECS/remote-hosted-service.md`. A zip of all databases on top of that.
4. **Account deletion.** Deletes the user's data dir, their `accounts` / `usage_daily` rows and their personal access tokens, and logs them out. State plainly what backups still hold and for how long.
5. **Cold starts.** `min_machines_running = 0` means the first request after idle waits for the machine to boot. Measure it. If a Claude tool call times out on a cold start, set it to 1.

### Stage 3 — Public face

1. **Domain.** Pick and attach a real domain before the first external user. Every connector a user adds stores this URL, so changing it later breaks every one of them. Update `PUBLIC_BASE_URL` and the WorkOS redirect URIs to match.
2. **Docs site.**
   - Add a "Hosted: sign in and connect" page: sign up, the connector URL, per-client setup (mirroring the in-app onboarding), what to try first.
   - Add a "Connect an agent" page from the README's personal access token section.
   - Fix the placeholder GitHub links in `docs/docs.json` and the getting-started pages.
   - Deploy it (Mintlify) under the real domain, e.g. `docs.<domain>`.
3. **Agent-facing entry point.** Serve `/llms.txt` from the app, and publish a short skill that tells an agent how to connect with a token the user gives it.
4. **Privacy policy and terms.** Users will store personal data (meal logs, health data). The privacy policy needs to cover what's stored, where, who can access it, backup retention, and deletion.
5. **Contact.** A support email on the landing page and docs.

### Stage 4 — Safety rails

1. **CI.** A GitHub Actions workflow running `bun test` and `bunx tsc --noEmit` on every PR. Fix the 23 existing type errors first so `tsc` can block merges.
2. **Monitoring.** An external uptime check on `/health`, alerting by email or push. Error alerting for 5xx responses. A "sign-in works" synthetic check is worth it given how stage 1 was discovered.
3. **Rate limiting** on `/mcp`, `/auth/*` and `/register`, per IP and per user. In-memory is fine at one machine.
4. **Usage enforcement.** Metering has been recording since #25. Review real numbers against the free-tier limits (200 calls/day, 50 MB, 3 databases), adjust, then decide whether to flip `USAGE_ENFORCE`. The limits exist to protect hosting cost; launch can run with enforcement off as long as someone watches the meter.

### Stage 5 — Agents and tokens

1. **Self-serve tokens.** A dashboard page to create, list and revoke personal access tokens, backed by the existing `PatStore`. The token is shown once, as the CLI does today. Needs CSRF protection on the create and revoke endpoints.
2. **Token scopes.** Optional per-token limits: specific databases, read-only. Deferred from #26.
3. **Muse / OpenClaw as the first real agent client.** Use them to validate the agent docs end to end.

## Later

- Shared accounts and databases (needs its own spec)
- Billing (`SPECS/usage-metering-billing.md` Phase 2)
- Native AuthKit DCR (see stage 1 note)
- Database import (#20)

## Open questions

1. **Which WorkOS account owns `healthy-moss-74-staging.authkit.app`?** If nobody can find it, stage 1 starts with a new environment and every existing connection has to reconnect.
2. **Domain name.**
3. **Litestream or snapshots for launch?** Depends on how many users the first cohort is.
4. **Who receives alerts,** and on what channel?
5. **Is launch Claude-only?** If other MCP clients matter at launch, native AuthKit DCR moves into stage 1.
