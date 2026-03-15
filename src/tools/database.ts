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
    {},
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
    "Return the full context for a named database — schema (tables, columns, types), description, and agent notes. Call this at the start of any session involving an existing database.",
    {
      database: z.string().describe("The name of the database to describe"),
    },
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
        const { description, notes } = registry.getMetadata(database);
        return {
          content: [{ type: "text", text: JSON.stringify({ description, notes, tables }) }],
        };
      });
    }
  );

  server.tool(
    "update_database_notes",
    "Write or replace freeform notes on a database. Use this to record conventions, valid enum values, data formatting rules, and anything a future session needs to know to use this database correctly. Notes are returned by describe_database.",
    {
      database: z.string().describe("The name of the database"),
      notes: z.string().describe("The notes content (replaces any existing notes)"),
    },
    async (args: unknown) => {
      const { database, notes } = args as { database: string; notes: string };
      return logger.wrap("update_database_notes", args, async () => {
        if (!registry.exists(database)) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: `Database "${database}" does not exist` }) }],
            isError: true,
          };
        }
        registry.updateNotes(database, notes);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, database }) }],
        };
      });
    }
  );
}
