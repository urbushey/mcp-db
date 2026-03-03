import { z } from "zod";
import type { DatabaseRegistry } from "../db/registry.ts";
import type { Logger } from "../logger.ts";
import type { TableSchema } from "../db/adapter.ts";

const ColumnDefSchema = z.object({
  name: z.string(),
  type: z.enum(["text", "integer", "real", "boolean"]),
  required: z.boolean().optional(),
  primaryKey: z.boolean().optional(),
});

const TableSchemaInput = z.object({
  name: z.string(),
  columns: z.array(ColumnDefSchema),
});

export function registerSchemaTools(
  server: { tool: (name: string, schema: object, handler: (args: unknown) => Promise<unknown>) => void },
  registry: DatabaseRegistry,
  logger: Logger
) {
  // propose_schema
  server.tool(
    "propose_schema",
    {
      description:
        "Given a plain-language description, return a structured schema proposal. Does NOT create anything — only proposes. Present the result to the user in plain English and wait for confirmation.",
      inputSchema: z.object({
        description: z.string().describe("Plain-language description of what the user wants to track"),
        existing_proposal: z.array(TableSchemaInput).optional().describe("Existing proposal to iterate on"),
      }),
    },
    async (args: unknown) => {
      const { description, existing_proposal } = args as {
        description: string;
        existing_proposal?: TableSchema[];
      };
      return logger.wrap("propose_schema", args, async () => {
        // The server returns the proposal structure for the AI to present.
        // If existing_proposal is provided, return it back for the AI to modify.
        const tables: TableSchema[] = existing_proposal ?? [];
        const summary = existing_proposal
          ? `Returning existing proposal for modification based on: "${description}"`
          : `Schema proposal for: "${description}"`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ tables, summary, description }),
            },
          ],
        };
      });
    }
  );

  // create_database
  server.tool(
    "create_database",
    {
      description: "Create a named database from a confirmed schema. Fails if the database already exists.",
      inputSchema: z.object({
        database: z.string().describe("The name for the new database"),
        tables: z.array(TableSchemaInput).describe("The confirmed table schemas"),
      }),
    },
    async (args: unknown) => {
      const { database, tables } = args as { database: string; tables: TableSchema[] };
      return logger.wrap("create_database", args, async () => {
        if (registry.exists(database)) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: `Database "${database}" already exists` }),
              },
            ],
            isError: true,
          };
        }

        const adapter = await registry.create(database);
        for (const table of tables) {
          await adapter.createTable(table);
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, database, tables: tables.map((t) => t.name) }),
            },
          ],
        };
      });
    }
  );
}
