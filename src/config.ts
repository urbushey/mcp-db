import { z } from "zod";

const ConfigSchema = z.object({
  DATA_DIR: z.string().default("./data"),
  LOG_LEVEL: z.enum(["verbose", "normal", "off"]).default("normal"),
  LOG_PATH: z.string().default("./logs/mcp.log"),
  MCP_TRANSPORT: z.enum(["stdio"]).default("stdio"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    console.error(`Configuration error:\n${errors}`);
    process.exit(1);
  }
  return result.data;
}
