import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error("Usage: bun run scripts/fly-smoke.ts <mcp-url>");
  process.exit(1);
}

const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
const client = new Client({ name: "fly-smoke", version: "0.0.1" });

await client.connect(transport);
const tools = await client.listTools();
console.log(JSON.stringify({ toolCount: tools.tools.length, toolNames: tools.tools.map((t) => t.name).sort() }, null, 2));
await client.close();
