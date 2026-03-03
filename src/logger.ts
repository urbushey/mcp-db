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

export class Logger {
  private logPath: string;
  private level: Config["LOG_LEVEL"];

  constructor(config: Pick<Config, "LOG_LEVEL" | "LOG_PATH">) {
    this.level = config.LOG_LEVEL;
    this.logPath = config.LOG_PATH;

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
    if (this.level === "off") return fn();

    const start = Date.now();
    try {
      const output = await fn();
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
