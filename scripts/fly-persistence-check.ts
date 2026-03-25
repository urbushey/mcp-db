import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const baseUrl = process.argv[2];
const dbName = process.argv[3] ?? `smoke_${Date.now()}`;
if (!baseUrl) {
  console.error("Usage: bun run scripts/fly-persistence-check.ts <mcp-url> [db-name]");
  process.exit(1);
}

async function connect() {
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
  const client = new Client({ name: "fly-persistence-check", version: "0.0.1" });
  await client.connect(transport);
  return client;
}

const client1 = await connect();
await client1.callTool({
  name: "create_database",
  arguments: {
    database: dbName,
    tables: [{ name: "items", columns: [{ name: "name", type: "text", required: true }] }],
  },
});
await client1.close();

const client2 = await connect();
const list = await client2.callTool({ name: "list_databases", arguments: {} });
await client2.close();

console.log(JSON.stringify({ database: dbName, list }, null, 2));
