import { z } from "zod";
import type { DatabaseRegistry } from "../db/registry.ts";
import type { Logger } from "../logger.ts";

type ToolServer = {
  tool: (name: string, description: string, schema: object, handler: (args: unknown) => Promise<unknown>) => void;
};

export function registerDatabaseTools(server: ToolServer, registry: DatabaseRegistry, logger: Logger) {
  server.tool(
    "list_databases",
    "List all named databases managed by this server instance.",
    z.object({}),
    async (_args: unknown) => {
      return logger.wrap("list_databases", {}, async () => {
        const databases = registry.list();
        return {
          content: [{ type: "text", text: JSON.stringify({ databases }) }],
        };
      });
    }
  );

  server.tool(
    "describe_database",
    "Return the schema of a named database — table names, columns, and types. Call this at the start of any session involving an existing database.",
    z.object({
      database: z.string().describe("The name of the database to describe"),
    }),
    async (args: unknown) => {
      const { database } = args as { database: string };
      return logger.wrap("describe_database", args, async () => {
        if (!registry.exists(database)) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: `Database "${database}" does not exist` }) }],
            isError: true,
          };
        }
        const adapter = registry.get(database);
        const tables = await adapter.getTables();
        return {
          content: [{ type: "text", text: JSON.stringify({ tables }) }],
        };
      });
    }
  );
}
