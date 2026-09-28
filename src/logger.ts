import { appendFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import type { Config } from "./config.ts";

export interface LogEntry {
  timestamp: string;
  tool: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  error?: string;
}

/**
 * Optional per-user usage metering, injected by the hosting layer.
 * check() runs before the tool executes; when it returns a rejection and
 * enforce is true, the tool is skipped and an MCP error result is returned
 * instead. record() runs only after a successful execution.
 */
export interface UsageHook {
  enforce: boolean;
  check(tool: string): { message: string } | null;
  record(tool: string): void;
}

export class Logger {
  private logPath: string;
  private level: Config["LOG_LEVEL"];
  private usage?: UsageHook;

  constructor(config: Pick<Config, "LOG_LEVEL" | "LOG_PATH">, usage?: UsageHook) {
    this.level = config.LOG_LEVEL;
    this.logPath = config.LOG_PATH;
    this.usage = usage;

    if (this.level !== "off") {
      const dir = dirname(this.logPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  log(entry: LogEntry): void {
    if (this.level === "off") return;
    appendFileSync(this.logPath, JSON.stringify(entry) + "\n", "utf-8");
  }

  async wrap<T>(
    tool: string,
    input: unknown,
    fn: () => Promise<T>
  ): Promise<T> {
    if (this.usage) {
      const rejection = this.usage.check(tool);
      if (rejection) {
        this.log({
          timestamp: new Date().toISOString(),
          tool,
          input,
          output: null,
          durationMs: 0,
          error: `${this.usage.enforce ? "quota_rejected" : "quota_would_reject"}: ${rejection.message}`,
        });
        if (this.usage.enforce) {
          return { content: [{ type: "text", text: rejection.message }], isError: true } as T;
        }
      }
    }

    if (this.level === "off" && !this.usage) return fn();

    const start = Date.now();
    try {
      const output = await fn();
      this.usage?.record(tool);
      this.log({
        timestamp: new Date().toISOString(),
        tool,
        input,
        output,
        durationMs: Date.now() - start,
      });
      return output;
    } catch (err) {
      this.log({
        timestamp: new Date().toISOString(),
        tool,
        input,
        output: null,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
