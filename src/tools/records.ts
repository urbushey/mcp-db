import { z } from "zod";
import type { DatabaseRegistry } from "../db/registry.ts";
import type { Logger } from "../logger.ts";
import type { QueryFilter, QueryOptions } from "../db/adapter.ts";

type ToolServer = {
  tool: (name: string, description: string, schema: object, handler: (args: unknown) => Promise<unknown>) => void;
};

const QueryFilterSchema = z.object({
  column: z.string(),
  operator: z.enum(["=", "!=", ">", "<", ">=", "<=", "like"]),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const QueryOptionsSchema = z.object({
  filters: z.array(QueryFilterSchema).optional(),
  orderBy: z.object({ column: z.string(), direction: z.enum(["asc", "desc"]) }).optional(),
  limit: z.number().int().positive().optional(),
});

function getAdapter(registry: DatabaseRegistry, database: string) {
  if (!registry.exists(database)) throw new Error(`Database "${database}" does not exist`);
  return registry.get(database);
}

function errorResponse(message: string) {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

export function registerRecordTools(server: ToolServer, registry: DatabaseRegistry, logger: Logger) {
  server.tool(
    "insert_record",
    "Insert a single record into a table. Returns the new row's ID.",
    {
      database: z.string(),
      table: z.string(),
      record: z.record(z.string(), z.unknown()),
    },
    async (args: unknown) => {
      const { database, table, record } = args as { database: string; table: string; record: Record<string, unknown> };
      return logger.wrap("insert_record", args, async () => {
        try {
          const adapter = getAdapter(registry, database);
          const { id } = await adapter.insert(table, record);
          return { content: [{ type: "text", text: JSON.stringify({ id }) }] };
        } catch (err) {
          return errorResponse(err instanceof Error ? err.message : String(err));
        }
      });
    }
  );

  server.tool(
    "query_records",
    "Query records with optional filters, ordering, and limit.",
    {
      database: z.string(),
      table: z.string(),
      options: QueryOptionsSchema.optional().default({}),
    },
    async (args: unknown) => {
      const { database, table, options } = args as { database: string; table: string; options: QueryOptions };
      return logger.wrap("query_records", args, async () => {
        try {
          const adapter = getAdapter(registry, database);
          const records = await adapter.query(table, options ?? {});
          return { content: [{ type: "text", text: JSON.stringify({ records, count: records.length }) }] };
        } catch (err) {
          return errorResponse(err instanceof Error ? err.message : String(err));
        }
      });
    }
  );

  server.tool(
    "update_record",
    "Update a record by ID.",
    {
      database: z.string(),
      table: z.string(),
      id: z.number().int(),
      updates: z.record(z.string(), z.unknown()),
    },
    async (args: unknown) => {
      const { database, table, id, updates } = args as { database: string; table: string; id: number; updates: Record<string, unknown> };
      return logger.wrap("update_record", args, async () => {
        try {
          const adapter = getAdapter(registry, database);
          await adapter.update(table, id, updates);
          return { content: [{ type: "text", text: JSON.stringify({ success: true }) }] };
        } catch (err) {
          return errorResponse(err instanceof Error ? err.message : String(err));
        }
      });
    }
  );

  server.tool(
    "delete_record",
    "Delete a record by ID.",
    { database: z.string(), table: z.string(), id: z.number().int() },
    async (args: unknown) => {
      const { database, table, id } = args as { database: string; table: string; id: number };
      return logger.wrap("delete_record", args, async () => {
        try {
          const adapter = getAdapter(registry, database);
          await adapter.delete(table, id);
          return { content: [{ type: "text", text: JSON.stringify({ success: true }) }] };
        } catch (err) {
          return errorResponse(err instanceof Error ? err.message : String(err));
        }
      });
    }
  );

  server.tool(
    "count_records",
    "Count records in a table, optionally filtered.",
    {
      database: z.string(),
      table: z.string(),
      filters: z.array(QueryFilterSchema).optional(),
    },
    async (args: unknown) => {
      const { database, table, filters } = args as { database: string; table: string; filters?: QueryFilter[] };
      return logger.wrap("count_records", args, async () => {
        try {
          const adapter = getAdapter(registry, database);
          const count = await adapter.count(table, filters);
          return { content: [{ type: "text", text: JSON.stringify({ count }) }] };
        } catch (err) {
          return errorResponse(err instanceof Error ? err.message : String(err));
        }
      });
    }
  );
}
