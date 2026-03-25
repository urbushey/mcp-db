import { loadConfig } from "./config.ts";
import { startConfiguredTransport } from "./transport.ts";

const config = loadConfig();
const running = await startConfiguredTransport(config);

if (running.kind === "http") {
  console.log(`MCP streamable HTTP server listening on ${running.url}`);
}
