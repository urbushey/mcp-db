import { z } from "zod";
import type { DatabaseRegistry } from "../db/registry.ts";
import type { Logger } from "../logger.ts";

export function registerDatabaseTools(
  server: { tool: (name: string, schema: object, handler: (args: unknown) => Promise<unknown>) => void },
  registry: DatabaseRegistry,
  logger: Logger
) {
  // list_databases
  server.tool(
    "list_databases",
    {
      description: "List all named databases managed by this server instance",
      inputSchema: z.object({}),
    },
    async (_args: unknown) => {
      return logger.wrap("list_databases", {}, async () => {
        const databases = registry.list();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ databases }),
            },
          ],
        };
      });
    }
  );

  // describe_database
  server.tool(
    "describe_database",
    {
      description:
        "Return the schema of a named database — table names, columns, and types. Call this at the start of any session involving an existing database.",
      inputSchema: z.object({
        database: z.string().describe("The name of the database to describe"),
      }),
    },
    async (args: unknown) => {
      const { database } = args as { database: string };
      return logger.wrap("describe_database", args, async () => {
        if (!registry.exists(database)) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: `Database "${database}" does not exist` }),
              },
            ],
            isError: true,
          };
        }

        const adapter = registry.get(database);
        const tables = await adapter.getTables();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ tables }),
            },
          ],
        };
      });
    }
  );
}
