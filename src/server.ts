import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.ts";
import { DatabaseRegistry } from "./db/registry.ts";
import { Logger } from "./logger.ts";
import { registerDatabaseTools } from "./tools/database.ts";
import { registerSchemaTools } from "./tools/schema.ts";
import { registerRecordTools } from "./tools/records.ts";
import { registerQueryTools } from "./tools/query.ts";
import { registerMutationTools } from "./tools/mutation.ts";

export async function createServer(config: Config) {
  const registry = new DatabaseRegistry(config.DATA_DIR);
  const logger = new Logger({ LOG_LEVEL: config.LOG_LEVEL, LOG_PATH: config.LOG_PATH });

  const server = new McpServer({
    name: "instant-db",
    version: "0.1.0",
  });

  registerDatabaseTools(server as Parameters<typeof registerDatabaseTools>[0], registry, logger);
  registerSchemaTools(server as Parameters<typeof registerSchemaTools>[0], registry, logger);
  registerRecordTools(server as Parameters<typeof registerRecordTools>[0], registry, logger);
  registerQueryTools(server as Parameters<typeof registerQueryTools>[0], registry, logger);
  registerMutationTools(server as Parameters<typeof registerMutationTools>[0], registry, logger);

  return { server, registry, logger };
}

