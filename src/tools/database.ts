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
        const fieldsMeta = registry.getFieldsMetadata(database);

        // Merge field metadata into column definitions
        const enrichedTables = tables.map((table) => ({
          ...table,
          columns: table.columns.map((col) => {
            const meta = fieldsMeta.find((f) => f.table_name === table.name && f.column_name === col.name);
            if (!meta) return col;
            return {
              ...col,
              ...(meta.display_name != null ? { displayName: meta.display_name } : {}),
              ...(meta.description != null ? { description: meta.description } : {}),
            };
          }),
        }));

        return {
          content: [{ type: "text", text: JSON.stringify({ description, notes, tables: enrichedTables }) }],
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

  server.tool(
    "delete_database",
    "Permanently delete a database, its SQLite file, and all associated metadata. Requires confirm=true to proceed. This action cannot be undone.",
    {
      database: z.string().describe("The name of the database to delete"),
      confirm: z.boolean().optional().describe("Must be true to confirm deletion"),
    },
    async (args: unknown) => {
      const { database, confirm } = args as { database: string; confirm?: boolean };
      return logger.wrap("delete_database", args, async () => {
        if (!confirm) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "You must pass confirm: true to delete a database. This action is irreversible." }) }],
            isError: true,
          };
        }
        if (!registry.exists(database)) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: `Database "${database}" does not exist` }) }],
            isError: true,
          };
        }
        registry.delete(database);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, deleted: database }) }],
        };
      });
    }
  );

  server.tool(
    "update_field_metadata",
    "Set a display name and/or description on a column. Use this to document what a field means, its valid values, units, or formatting rules. Field metadata is returned by describe_database.",
    {
      database: z.string().describe("The name of the database"),
      table: z.string().describe("The table name"),
      column: z.string().describe("The column name"),
      displayName: z.string().optional().describe("Human-readable display name (e.g. 'Saturated Fat (g)')"),
      description: z.string().optional().describe("What this field means, valid values, units, etc."),
    },
    async (args: unknown) => {
      const { database, table, column, displayName, description } = args as {
        database: string; table: string; column: string; displayName?: string; description?: string;
      };
      return logger.wrap("update_field_metadata", args, async () => {
        if (!registry.exists(database)) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: `Database "${database}" does not exist` }) }],
            isError: true,
          };
        }
        registry.updateFieldMetadata(database, table, column, displayName, description);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, database, table, column }) }],
        };
      });
    }
  );
}
