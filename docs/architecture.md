# Architecture Overview

This project supports two deployment shapes with the same core MCP tool layer:

1. **Local / stdio mode** for Claude Desktop or Claude Code
2. **Hosted / HTTP mode** for a remote MCP deployment on Fly.io with OAuth in front of it

The important design choice is that the tool handlers and database layer stay the same in both modes. The transport and auth layers change; the database operations do not.

## High-level idea

- `src/index.ts` loads config and starts the configured transport
- `src/transport.ts` chooses between stdio and streamable HTTP
- `src/server.ts` builds the MCP server and registers tools
- `src/tools/*` implement the actual MCP behaviors
- `src/db/*` persists metadata and SQLite databases
- `src/auth.ts` verifies bearer tokens for hosted HTTP mode and derives per-user storage paths

## Architecture diagram

```text
                          LOCAL MODE

   Claude Desktop / Claude Code
               |
               | stdio
               v
        +-------------------+
        |   instant-db MCP   |
        |  (Bun process)     |
        +-------------------+
               |
               v
        +-------------------+
        |   Tool handlers    |
        |  schema/query/etc  |
        +-------------------+
               |
               v
        +-------------------+
        | DatabaseRegistry   |
        | _metadata.sqlite   |
        +-------------------+
               |
               v
        +-------------------+
        | SQLite files       |
        | data/*.sqlite      |
        +-------------------+


                         HOSTED MODE

   Claude web / mobile / remote client
               |
               | HTTPS + MCP Streamable HTTP
               v
        +-------------------------------+
        | Fly.io app                    |
        | mcp-db-mvp-labmind.fly.dev    |
        +-------------------------------+
               |
               v
        +-------------------------------+
        | HTTP transport layer          |
        | /mcp, /health, /.well-known/* |
        +-------------------------------+
               |
               | bearer token
               v
        +-------------------------------+
        | Auth layer                    |
        | WorkOS/AuthKit-issued token   |
        | verification + 401 challenge  |
        +-------------------------------+
               |
               | subject -> hashed user path
               v
        +-------------------------------+
        | MCP server + tool handlers    |
        +-------------------------------+
               |
               v
        +-------------------------------+
        | Per-user storage              |
        | data/users/<hash>/            |
        | _metadata.sqlite + *.sqlite   |
        +-------------------------------+
```

## Component breakdown

### 1) Config

`src/config.ts`

Responsible for:
- loading environment variables
- deciding whether the app runs in `stdio` or `http` mode
- validating auth-related settings for hosted mode

Key settings:
- `MCP_TRANSPORT`
- `MCP_HTTP_HOST`
- `MCP_HTTP_PORT`
- `MCP_HTTP_PATH`
- `AUTH_REQUIRED`
- `OAUTH_ISSUER`
- `OAUTH_AUDIENCE`
- `OAUTH_JWKS_URL`
- `PUBLIC_BASE_URL`

### 2) Transport layer

`src/transport.ts`

This is the boundary between the outside world and the MCP server.

In local mode it:
- starts `StdioServerTransport`

In hosted mode it:
- serves `POST /mcp`
- answers `HEAD /mcp` with `MCP-Protocol-Version`
- serves `/health`
- serves `/.well-known/oauth-protected-resource`
- returns `401` with a `WWW-Authenticate` challenge when auth is required and missing/invalid

### 3) Auth layer

`src/auth.ts`

Only used for hosted HTTP mode.

Responsible for:
- extracting bearer tokens from the `Authorization` header
- verifying JWTs against WorkOS/AuthKit JWKS
- reading the token subject (`sub`)
- mapping that subject to a stable hashed storage key

That lets the hosted deployment isolate each user's data without changing the tool layer.

### 4) MCP server assembly

`src/server.ts`

Responsible for:
- constructing the `McpServer`
- constructing the `DatabaseRegistry`
- constructing the logger
- registering all tool groups

This is the shared middle layer used by both local and hosted mode.

### 5) Tool handlers

`src/tools/database.ts`
`src/tools/schema.ts`
`src/tools/records.ts`
`src/tools/query.ts`
`src/tools/mutation.ts`

Responsible for implementing the actual MCP API that the client sees.

Examples:
- `list_databases`
- `create_database`
- `create_table`
- `insert_record`
- `query_records`
- `execute_query`
- `execute_mutation`

These handlers do not need to care whether requests arrived over stdio or HTTP.

### 6) Storage layer

`src/db/registry.ts`
`src/db/sqlite.ts`

Responsible for:
- keeping the metadata registry in `_metadata.sqlite`
- opening and managing the user/database-specific SQLite files
- creating one SQLite file per logical database

Local mode uses:
- `data/`

Hosted mode uses:
- `data/users/<hashed-subject>/`

That means the hosted deployment gets app-layer multi-tenancy while preserving the same underlying database model.

## Request flow examples

### Local request flow

1. Claude Desktop launches the MCP process over stdio
2. The app builds the MCP server and registers tools
3. Claude calls a tool like `create_database`
4. The tool uses `DatabaseRegistry`
5. SQLite files are written under `data/`

### Hosted request flow

1. Remote client calls `https://.../mcp`
2. HTTP transport checks whether auth is required
3. Auth layer verifies the bearer token
4. The token subject is mapped to `data/users/<hash>/`
5. The MCP server is created with that scoped data directory
6. Tool handlers run exactly as they do locally
7. SQLite files are written only inside that user's directory

## Why this design works

### Shared core logic

The same:
- tool handlers
- registry logic
- SQLite adapter
- data model

work in both local and hosted mode.

That keeps behavior consistent and lowers the chance that local and remote deployments drift apart.

### Backward compatibility

`MCP_TRANSPORT=stdio` remains the default path, so existing local users do not have to change anything.

### Incremental hosting path

The hosted MVP can be layered on top of the local server by adding:
- HTTP transport
- OAuth metadata + bearer auth
- per-user storage scoping
- Fly deployment

without rewriting the actual tool logic.

## Current status

As of the current MVP work:
- local stdio mode is implemented
- hosted streamable HTTP mode is implemented
- protected-resource metadata is implemented
- bearer-token verification hooks are implemented
- per-user storage scoping is implemented
- Fly deployment is live
- final WorkOS/AuthKit end-to-end auth wiring is the remaining hosted-MVP step

## Files to read next

- `README.md` — project overview
- `docs/fly-deployment.md` — hosted deployment notes
- `docs/decisions/0001-remote-mcp-oauth-provider.md` — why WorkOS/AuthKit is the MVP choice
- `SPECS/remote-hosted-service.md` — broader hosted-service plan
