import { z } from "zod";
import type { DatabaseRegistry } from "../db/registry.ts";
import type { Logger } from "../logger.ts";
import type { TableSchema } from "../db/adapter.ts";

type ToolServer = {
  tool: (name: string, description: string, schema: object, handler: (args: unknown) => Promise<unknown>) => void;
};

const ColumnDefSchema = z.object({
  name: z.string(),
  type: z.enum(["text", "integer", "real", "boolean"]),
  required: z.boolean().optional(),
  primaryKey: z.boolean().optional(),
  displayName: z.string().optional().describe("Human-readable display name"),
  description: z.string().optional().describe("What this field means, valid values, units, etc."),
});

const TableSchemaInput = z.object({
  name: z.string(),
  columns: z.array(ColumnDefSchema),
});

export function registerSchemaTools(server: ToolServer, registry: DatabaseRegistry, logger: Logger) {
  server.tool(
    "create_database",
    "Create a named database from a confirmed schema. Fails if the database already exists. After creating, consider using update_database_notes to record conventions and usage guidelines for future sessions.",
    {
      database: z.string().describe("The name for the new database"),
      tables: z.array(TableSchemaInput).describe("The confirmed table schemas"),
      description: z.string().optional().describe("A short description of what this database is for"),
    },
    async (args: unknown) => {
      const { database, tables, description } = args as {
        database: string;
        tables: (TableSchema & { columns: (TableSchema["columns"][number] & { displayName?: string; description?: string })[] })[];
        description?: string;
      };
      return logger.wrap("create_database", args, async () => {
        if (!database || typeof database !== "string" || database.trim().length === 0) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "Database name must be a non-empty string" }) }],
            isError: true,
          };
        }
        if (registry.exists(database)) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: `Database "${database}" already exists` }) }],
            isError: true,
          };
        }
        const adapter = await registry.create(database, description);
        for (const table of tables) {
          await adapter.createTable(table);
          for (const col of table.columns) {
            if (col.displayName || col.description) {
              registry.updateFieldMetadata(database, table.name, col.name, col.displayName, col.description);
            }
          }
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, database, tables: tables.map((t) => t.name) }) }],
        };
      });
    }
  );

  server.tool(
    "create_table",
    "Add a new table to an existing database. Use this to evolve a database schema without recreating it. Fails if the table already exists.",
    {
      database: z.string().describe("The name of the existing database"),
      table: TableSchemaInput.describe("The table schema to create"),
    },
    async (args: unknown) => {
      const { database, table } = args as {
        database: string;
        table: TableSchema & { columns: (TableSchema["columns"][number] & { displayName?: string; description?: string })[] };
      };
      return logger.wrap("create_table", args, async () => {
        if (!registry.exists(database)) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: `Database "${database}" does not exist` }) }],
            isError: true,
          };
        }
        const adapter = registry.get(database);
        if (await adapter.tableExists(table.name)) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: `Table "${table.name}" already exists in database "${database}"` }) }],
            isError: true,
          };
        }
        await adapter.createTable(table);
        for (const col of table.columns) {
          if (col.displayName || col.description) {
            registry.updateFieldMetadata(database, table.name, col.name, col.displayName, col.description);
          }
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, database, table: table.name }) }],
        };
      });
    }
  );
}
