/**
 * Manage personal access tokens for headless MCP clients.
 *
 *   bun run scripts/pat.ts create --sub <user-sub> --name <label> [--expires-days N]
 *   bun run scripts/pat.ts list   --sub <user-sub>
 *   bun run scripts/pat.ts revoke --sub <user-sub> --id <token-id>
 *
 * Reads DATA_DIR from the environment (default ./data), the same as the server.
 */
import { parseArgs } from "node:util";
import { PatStore } from "../src/pat.ts";

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    sub: { type: "string" },
    name: { type: "string" },
    id: { type: "string" },
    "expires-days": { type: "string" },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const command = positionals[0];
const subject = values.sub ?? fail("--sub is required (your user id; see /api/me on the dashboard)");
const store = new PatStore(process.env.DATA_DIR ?? "./data");

try {
  if (command === "create") {
    const name = values.name ?? fail("--name is required");
    const days = values["expires-days"] ? Number(values["expires-days"]) : undefined;
    if (days !== undefined && !(days > 0)) fail("--expires-days must be a positive number");
    const expiresAt = days ? Date.now() + days * 24 * 60 * 60 * 1000 : undefined;

    const { id, token } = store.create({ subject, name, expiresAt });
    console.log(`Created token ${id} (${name})${expiresAt ? `, expires ${new Date(expiresAt).toISOString()}` : ""}.`);
    console.log("Copy it now. It is not stored and can't be shown again:\n");
    console.log(token);
  } else if (command === "list") {
    const fmt = (ms: number | null) => (ms ? new Date(ms).toISOString() : "-");
    for (const t of store.list(subject)) {
      const status = t.revokedAt ? "revoked" : t.expiresAt && t.expiresAt <= Date.now() ? "expired" : "active";
      console.log(`${t.id}  ${status.padEnd(7)}  ${t.name}  created ${fmt(t.createdAt)}  last used ${fmt(t.lastUsedAt)}  expires ${fmt(t.expiresAt)}`);
    }
  } else if (command === "revoke") {
    const id = values.id ?? fail("--id is required");
    if (!store.revoke(subject, id)) fail(`No active token ${id} for that user`);
    console.log(`Revoked ${id}.`);
  } else {
    fail("Usage: bun run scripts/pat.ts <create|list|revoke> --sub <user-sub> [--name <label>] [--id <id>] [--expires-days N]");
  }
} finally {
  store.close();
}
