# instant-db Cloud: Remote Hosted Service

## Status
Draft — March 2026

## Current State

instant-db is an MCP server that gives Claude the ability to create, query, and manage SQLite databases through natural conversation. It runs locally via stdio transport, meaning Claude spawns the process and communicates over stdin/stdout.

### What exists today

- **MCP server** (`src/index.ts`) using `StdioServerTransport` — local only
- **Multi-database management** via `DatabaseRegistry` backed by `_metadata.sqlite`
- **12 tools**: `list_databases`, `describe_database`, `create_database`, `create_table`, `insert_record`, `query_records`, `update_record`, `delete_record`, `count_records`, `execute_query`, `execute_mutation`, `update_database_notes`, `update_field_metadata`
- **Rich metadata layer**: database-level descriptions/notes, field-level display names/descriptions
- **SQLite storage**: each database is a separate `.sqlite` file in a `data/` directory
- **Runtime**: Bun with `bun:sqlite` (native, no native addons)
- **Tests**: 124 tests across 11 files, all passing

### What doesn't exist

- No remote transport (HTTP, WebSocket, SSE)
- No authentication or user management
- No multi-tenancy — single user, single data directory
- No encryption at rest
- No rate limiting
- No web UI (MCPDB-8 is on the backlog)

### Supported clients today

| Client | Transport | Works today |
|--------|-----------|-------------|
| Claude Code (CLI) | stdio | Yes |
| Claude Desktop | stdio | Yes |
| Claude iOS/Android | Remote MCP (HTTP) | **No** |
| Claude web (claude.ai) | Remote MCP (HTTP) | **No** |

---

## Problem

Claude mobile and web clients only support remote MCP servers — they cannot spawn local processes. This means instant-db is inaccessible from phones, tablets, and claude.ai. Additionally, non-developer power users who want persistent databases accessible across all their devices have no option today without self-hosting infrastructure.

## Target User

A Claude power user — someone who actively uses Claude daily but is not a developer who would stand up their own PostgreSQL instance. They want:

- Databases that "just work" without ops
- Access from any device (desktop, phone, web)
- Their data to persist across conversations and sessions
- The ability to export their data at any time

## Solution

**instant-db Cloud** — a hosted service that runs the instant-db MCP server on behalf of users, providing remote access from any Claude client with OAuth authentication.

---

## Architecture

### High-Level

```
Claude (any client)
    |
    | HTTPS (Streamable HTTP transport)
    |
[instant-db Cloud]
    |-- Auth layer (OAuth 2.1 via third-party provider)
    |-- MCP server (existing tools, unchanged)
    |-- User isolation (per-user data directories)
    |-- SQLite files (encrypted at rest)
    |-- Metadata DB (_metadata.sqlite per user)
```

### Transport

The MCP SDK supports Streamable HTTP transport. Claude mobile requires:

- `POST /mcp` endpoint for JSON-RPC messages
- `HEAD /mcp` returning `MCP-Protocol-Version: 2025-06-18` header
- Session management via `Mcp-Session-Id` headers
- OAuth 2.1 with Dynamic Client Registration

The existing tool handlers are transport-agnostic — they work identically over stdio or HTTP. The change is swapping `StdioServerTransport` for `StreamableHTTPServerTransport` based on a config flag.

### Multi-Tenancy

**Phase 1: Shared infrastructure, app-layer isolation**

- Single server process handles all users
- Each user gets a namespaced data directory: `data/{user_id}/`
- Each user has their own `_metadata.sqlite` and database files
- Request middleware extracts user identity from OAuth token and scopes the `DatabaseRegistry` to that user's directory
- All database operations are scoped — User A cannot access User B's databases

**Phase 2 (future): Per-user isolation**

- Move to per-user containers or processes for stronger isolation
- Driven by scale and compliance requirements

### Authentication

**OAuth 2.1 via third-party provider (recommended for MVP: WorkOS AuthKit / Connect; Auth0 as fallback)**

- Required for Claude mobile — it uses OAuth to authenticate with remote MCP servers
- Dynamic Client Registration endpoint (Claude can't pre-configure credentials)
- OAuth callback URL: `https://claude.ai/api/mcp/auth_callback`
- Token-based auth on every MCP request

**Why third-party:** Faster to ship, built-in MFA, password reset, social login. Avoids building and maintaining a custom auth server. Cost scales with users.

**User onboarding flow:**

1. User goes to `instantdb.dev` (or similar), signs up via OAuth provider
2. User adds `https://mcp.instantdb.dev` as a remote MCP connector in Claude settings
3. Claude initiates OAuth flow, user authorizes
4. Done — all Claude clients (desktop, mobile, web) can now use instant-db

### Security

Security is a core design principle, not an afterthought.

**Data at rest:**
- All SQLite files encrypted at rest using AES-256 with server-managed keys
- Keys stored in a secrets manager (e.g., AWS KMS, Vault), not on disk
- Per-user encryption keys — compromise of one user's key doesn't expose others

**Data in transit:**
- TLS 1.3 required on all endpoints
- No plaintext HTTP

**Access control:**
- Every request authenticated via OAuth token
- User identity extracted from token and used to scope all database operations
- No cross-user data access possible at the application layer
- Rate limiting per user (see Limits section)

**Audit logging:**
- Every tool call logged with: timestamp, user ID, tool name, database name, duration
- Logs retained for 90 days
- Users can request their audit log via the dashboard

**Agent permissions:**
- Same as local — full agent autonomy (create, read, write, delete)
- The user trusts their Claude agent; the hosted service doesn't add friction
- If tiered permissions are needed later, they can be added as a dashboard setting

### Data Portability

**Critical requirement.** Users must be able to export their data at any time.

- Dashboard includes a "Download" button per database that serves the raw `.sqlite` file
- Bulk export: download all databases as a `.zip`
- Export includes metadata (descriptions, notes, field metadata) as a sidecar JSON
- Users can take their exported databases and use them with a local instant-db server with zero changes

This is a trust signal: "Your data is yours. We host it for convenience, not lock-in."

---

## Web Dashboard

Essential for v1. Users need a way to manage their account and see their data.

### Pages

**Account**
- Profile, email, plan tier
- Usage stats (tool calls, storage used)
- Billing management (Stripe integration)

**Databases**
- List all databases with description, table count, size, last accessed
- Click into a database to browse tables and rows (read-only in v1)
- Download individual database or bulk export
- View database notes and field metadata

**Audit Log**
- Searchable list of tool calls with timestamp, tool, database, status
- Filter by date range, tool type, database

**API / Connections**
- Show MCP endpoint URL
- OAuth status and connected clients
- Revoke access

### Tech

- Built with Bun + `Bun.serve()` HTML imports (consistent with CLAUDE.md)
- Ties into MCPDB-8 (web UI for browsing databases) — this becomes the authenticated version of that

---

## Limits and Pricing

### Free Tier

| Resource | Limit |
|----------|-------|
| Databases | 3 |
| Storage | 50 MB total |
| Tool calls | 100 / day |
| Data export | Always available |

### Paid Tier (~$8-12/mo, TBD)

| Resource | Limit |
|----------|-------|
| Databases | Unlimited |
| Storage | 5 GB |
| Tool calls | 10,000 / day |
| Data export | Always available |
| Priority support | Yes |

### Enforcement

- Rate limits enforced at the middleware layer before tool handlers
- When a limit is hit, the tool returns a clear error message explaining the limit and how to upgrade
- Storage limits checked on write operations (insert, create_database, create_table)
- Billing via Stripe — webhook-driven plan changes

---

## Implementation Phases

### Phase 1: Remote Transport + Auth (MVP)

**Goal:** instant-db accessible from Claude mobile/web with user accounts.

- Add Streamable HTTP transport to existing server (`TRANSPORT=http` env var)
- Integrate third-party OAuth provider
- Implement Dynamic Client Registration endpoint
- Add user-scoped `DatabaseRegistry` (middleware extracts user ID, creates per-user data dir)
- Encryption at rest for SQLite files
- Basic rate limiting
- Deploy to a single cloud provider (containerized)
- Minimal dashboard: sign up, see MCP endpoint, manage account

**Backward compatible:** `TRANSPORT=stdio` (default) preserves existing local behavior. No changes for Claude Code or Desktop users.

### Phase 2: Dashboard + Billing

- Full web dashboard with database browsing (extends MCPDB-8)
- Stripe billing integration
- Free/paid tier enforcement
- Audit log UI
- Data export (individual + bulk)

### Phase 3: Scale + Polish

- Per-user isolation (containers)
- Multi-region deployment
- Backup and restore
- Team/shared databases
- Usage analytics and alerts

---

## Open Questions

1. **Domain / branding**: `instantdb.dev`? `instant-db.io`? Need to check availability. (Note: "InstantDB" is an existing product — may need to differentiate.)
2. **OAuth provider choice**: Resolved for MVP in issue #11 / ADR 0001 — use WorkOS AuthKit / Connect. Auth0 remains the fallback if pricing or token-shape constraints block WorkOS. Clerk is not a good fit for the remote MCP authorization-server role.
3. **Hosting provider**: Fly.io, Railway, AWS, GCP? Decision should be driven by cost, latency, and ease of deploying Bun-based services.
4. **Open source boundary**: The local MCP server stays open source. The hosting layer (multi-tenancy, auth, billing, dashboard) — open source or proprietary? Deferred.
5. **SQLite concurrency**: A single Bun process with WAL mode handles concurrent reads well, but multiple users writing simultaneously needs load testing. May need connection pooling or write queuing.
6. **Backup strategy**: How often? Where? User-triggered vs automatic?
7. **GDPR / data residency**: If users are in the EU, does data need to stay in EU? Affects multi-region planning.
