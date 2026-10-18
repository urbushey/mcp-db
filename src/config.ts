import { z } from "zod";

const OptionalUrl = z.string().url().optional();
const EnvBoolean = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  }
  return value;
}, z.boolean());

const ConfigSchema = z.object({
  DATA_DIR: z.string().default("./data"),
  LOG_LEVEL: z.enum(["verbose", "normal", "off"]).default("normal"),
  LOG_PATH: z.string().default("./logs/mcp.log"),
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  MCP_HTTP_HOST: z.string().default("127.0.0.1"),
  MCP_HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  MCP_HTTP_PATH: z.string().default("/mcp").transform((value) => value.startsWith("/") ? value : `/${value}`),
  AUTH_REQUIRED: EnvBoolean.default(false),
  // Quota enforcement (billing spec Phase 1 ships metering with this off)
  USAGE_ENFORCE: EnvBoolean.default(false),
  OAUTH_ISSUER: OptionalUrl,
  OAUTH_AUDIENCE: z.string().optional(),
  OAUTH_JWKS_URL: OptionalUrl,
  PUBLIC_BASE_URL: OptionalUrl,
  // OAuth endpoints for DCR proxy and dashboard auth
  OAUTH_AUTH_ENDPOINT: OptionalUrl,
  OAUTH_TOKEN_ENDPOINT: OptionalUrl,
  // DCR (Dynamic Client Registration) pre-configured credentials
  DCR_CLIENT_ID: z.string().optional(),
  DCR_CLIENT_SECRET: z.string().optional(),
  // Dashboard session signing secret
  SESSION_SECRET: z.string().optional(),
  // Path to built web assets (set automatically in Docker)
  WEB_DIST_DIR: z.string().default("./web/dist"),
}).superRefine((config, ctx) => {
  if (config.AUTH_REQUIRED && !config.OAUTH_ISSUER) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OAUTH_ISSUER"],
      message: "OAUTH_ISSUER is required when AUTH_REQUIRED=true",
    });
  }

  if (config.MCP_TRANSPORT === "http" && config.AUTH_REQUIRED) {
    // Without these the server starts but dashboard sign-in and /register
    // return 503. Fail at startup so a half-configured deploy never goes live.
    for (const key of [
      "PUBLIC_BASE_URL",
      "OAUTH_AUTH_ENDPOINT",
      "OAUTH_TOKEN_ENDPOINT",
      "DCR_CLIENT_ID",
      "DCR_CLIENT_SECRET",
      "SESSION_SECRET",
    ] as const) {
      if (!config[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required for authenticated HTTP transport`,
        });
      }
    }
  }
});

export type Config = z.infer<typeof ConfigSchema>;

export function parseConfig(env: Record<string, string | undefined>): { config?: Config; errors?: string[] } {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    return { errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  return { config: result.data };
}

export function loadConfig(): Config {
  const { config, errors } = parseConfig(process.env);
  if (!config) {
    console.error(`Configuration error:\n${errors!.join("\n")}`);
    process.exit(1);
  }
  return config;
}
