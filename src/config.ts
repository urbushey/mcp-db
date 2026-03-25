import { z } from "zod";

const OptionalUrl = z.string().url().optional();

const ConfigSchema = z.object({
  DATA_DIR: z.string().default("./data"),
  LOG_LEVEL: z.enum(["verbose", "normal", "off"]).default("normal"),
  LOG_PATH: z.string().default("./logs/mcp.log"),
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  MCP_HTTP_HOST: z.string().default("127.0.0.1"),
  MCP_HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  MCP_HTTP_PATH: z.string().default("/mcp").transform((value) => value.startsWith("/") ? value : `/${value}`),
  AUTH_REQUIRED: z.coerce.boolean().default(false),
  OAUTH_ISSUER: OptionalUrl,
  OAUTH_AUDIENCE: z.string().optional(),
  OAUTH_JWKS_URL: OptionalUrl,
  PUBLIC_BASE_URL: OptionalUrl,
}).superRefine((config, ctx) => {
  if (config.AUTH_REQUIRED && !config.OAUTH_ISSUER) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OAUTH_ISSUER"],
      message: "OAUTH_ISSUER is required when AUTH_REQUIRED=true",
    });
  }

  if (config.AUTH_REQUIRED && !config.OAUTH_AUDIENCE) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OAUTH_AUDIENCE"],
      message: "OAUTH_AUDIENCE is required when AUTH_REQUIRED=true",
    });
  }

  if (config.MCP_TRANSPORT === "http" && config.AUTH_REQUIRED && !config.PUBLIC_BASE_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["PUBLIC_BASE_URL"],
      message: "PUBLIC_BASE_URL is required for authenticated HTTP transport",
    });
  }
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
