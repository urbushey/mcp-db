# instant-db

An MCP server that lets any connected AI assistant create and manage structured databases through natural language alone. No SQL. No schema files. Just describe what you want to track and start using it.

**Runtime:** Bun · **Language:** TypeScript · **Storage:** SQLite (via `bun:sqlite`)

---

## What It Does

> *"I want to track my workouts — exercises, sets, reps, and weights."*

Claude calls the MCP server, proposes a schema in plain English, waits for your confirmation, creates the database, and from that point on handles all inserts, queries, updates, and deletes — across sessions, persistently.

---

## Setup (under 10 minutes)

### 1. Clone and install

```bash
git clone https://github.com/your-username/instant-db
cd instant-db
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env if you want custom paths (defaults work fine)
```

### 3. Add to Claude Desktop

Edit your `claude_desktop_config.json` (usually at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "instant-db": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/instant-db/src/index.ts"],
      "env": {
        "DATA_DIR": "/absolute/path/to/instant-db/data",
        "LOG_LEVEL": "normal"
      }
    }
  }
}
```

Replace `/absolute/path/to/instant-db` with the actual path where you cloned the repo.

### 4. Restart Claude Desktop

The instant-db tools will appear in Claude's tool list. You're done.

---

## Usage

### Start a new database

> *"I want to track my workouts — exercises, sets, reps, and weights."*

Claude will propose a schema, you refine it in plain English, then confirm. The database is created.

### Use it

> *"Log today's workout — 3 sets of 8 squats at 185 lbs."*
> *"How much did I squat last week?"*
> *"What's my heaviest bench press ever?"*

Data persists across sessions automatically.

---

## Recommended System Prompt

Add this to your Claude system prompt for best results:

```
You have access to an instant-db MCP server for persistent structured storage.
When a user wants to track or store anything:
1. Call list_databases first to check what already exists.
2. If no relevant database exists, call propose_schema and present the proposal
   conversationally — don't dump JSON at the user.
3. Wait for explicit user confirmation before calling create_database.
4. Always call describe_database at the start of a new session before inserting
   or querying, so you know the current schema.
```

---

## MCP Tools Reference

| Tool | Purpose |
|---|---|
| `list_databases` | List all databases managed by this server |
| `describe_database` | Get the schema of a named database |
| `propose_schema` | Propose a schema from a plain-language description (no-op, for AI reasoning) |
| `create_database` | Create a named database from a confirmed schema |
| `insert_record` | Insert a record, returns new row ID |
| `query_records` | Query with optional filters, ordering, limit |
| `update_record` | Update a record by ID |
| `delete_record` | Delete a record by ID |
| `count_records` | Count records, optionally filtered |

---

## Debugging

Every MCP tool call is logged to `logs/mcp.log` in JSONL format.

```bash
# Live tail with pretty output
tail -f logs/mcp.log | jq .
```

Log level is controlled by the `LOG_LEVEL` env var: `verbose` | `normal` | `off`

SQLite files are standard — open them in [DB Browser for SQLite](https://sqlitebrowser.org/) or any SQLite tool.

---

## Configuration

All config via `.env`:

```bash
DATA_DIR=./data          # Where .sqlite files are stored
LOG_LEVEL=normal         # verbose | normal | off
LOG_PATH=./logs/mcp.log  # Log file location
MCP_TRANSPORT=stdio      # Always stdio for Claude Desktop
```

---

## Development

```bash
# Run tests
bun test

# Run the server directly (for debugging)
bun run src/index.ts
```

## Fly.io status

Fly deployment scaffolding exists in:

- `Dockerfile`
- `.dockerignore`
- `fly.toml.example`
- `docs/fly-deployment.md`

The repo now includes streamable HTTP transport plus protected-resource metadata / bearer-token auth hooks for remote MCP. The remaining hosted-MVP work is deploying with real OAuth issuer settings, validating against a real WorkOS setup, and confirming the end-to-end Claude-compatible flow.

### Repository Structure

```
src/
  index.ts          # Entry point
  server.ts         # MCP server setup, tool registration
  config.ts         # Env var loading (Zod-validated)
  logger.ts         # JSONL request/response logger
  tools/
    database.ts     # list_databases, describe_database
    schema.ts       # propose_schema, create_database
    records.ts      # insert, query, update, delete, count
  db/
    adapter.ts      # IDbAdapter interface
    sqlite.ts       # SQLite implementation
    registry.ts     # Multi-database manager
data/               # SQLite files (gitignored)
logs/               # MCP logs (gitignored)
```

---

## Multiple Databases

One server instance manages as many named databases as you want:

> *"Create a calories tracker"*
> *"Create a finances tracker"*
> *"List my databases"* → `["workouts", "calories", "finances"]`

Each database is a separate `.sqlite` file in `data/`.

---

## What's Not in MVP

- Schema migrations (add/rename columns after creation)
- Joins / cross-table queries
- Batch insert
- Data export (CSV, JSON)
- Web UI (use any SQLite browser directly)
- Postgres adapter (interface ready, implementation deferred)
- Auth / access control

---

## License

MIT
