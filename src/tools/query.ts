import { z } from "zod";
import type { DatabaseRegistry } from "../db/registry.ts";
import type { Logger } from "../logger.ts";

type ToolServer = {
  tool: (name: string, description: string, schema: object, handler: (args: unknown) => Promise<unknown>) => void;
};

function getAdapter(registry: DatabaseRegistry, database: string) {
  if (!registry.exists(database)) throw new Error(`Database "${database}" does not exist`);
  return registry.get(database);
}

function errorResponse(message: string) {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

export function registerQueryTools(server: ToolServer, registry: DatabaseRegistry, logger: Logger) {
  server.tool(
    "execute_query",
    "Execute a read-only SQL query (SELECT/WITH) against a database. Supports joins, aggregates, GROUP BY, subqueries, and CTEs.",
    {
      database: z.string(),
      sql: z.string(),
      params: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
    },
    async (args: unknown) => {
      const { database, sql, params } = args as { database: string; sql: string; params?: (string | number | boolean)[] };
      return logger.wrap("execute_query", args, async () => {
        try {
          const adapter = getAdapter(registry, database);
          const rows = await adapter.execute(sql, params);
          return { content: [{ type: "text", text: JSON.stringify({ rows, count: rows.length }) }] };
        } catch (err) {
          return errorResponse(err instanceof Error ? err.message : String(err));
        }
      });
    }
  );
}
