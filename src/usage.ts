/**
 * Usage metering (billing spec Phase 1: meter everything, enforce optionally).
 * Control-plane data — lives in DATA_DIR/_accounts.sqlite at the hosting layer,
 * never inside a user's own data directory, so exported user data stays clean.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { UsageHook } from "./logger.ts";

export type PlanLimits = {
  toolCallsPerDay: number;
  storageBytes: number;
  databases: number;
};

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: { toolCallsPerDay: 200, storageBytes: 50 * 1024 * 1024, databases: 3 },
  pro: { toolCallsPerDay: 10_000, storageBytes: 5 * 1024 * 1024 * 1024, databases: Number.POSITIVE_INFINITY },
};

// Only these can grow storage; reads are never storage-gated.
const GROWTH_TOOLS = new Set(["insert_record", "execute_mutation", "create_database", "create_table"]);

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export class UsageStore {
  private db: Database;

  constructor(rootDataDir: string) {
    mkdirSync(rootDataDir, { recursive: true });
    this.db = new Database(join(rootDataDir, "_accounts.sqlite"));
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        user_id TEXT PRIMARY KEY,
        email TEXT,
        plan TEXT NOT NULL DEFAULT 'free',
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        subscription_status TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usage_daily (
        user_id TEXT NOT NULL,
        day TEXT NOT NULL,
        tool_calls INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, day)
      );
    `);
  }

  ensureAccount(userId: string): void {
    const now = Date.now();
    this.db
      .query("INSERT OR IGNORE INTO accounts (user_id, plan, created_at, updated_at) VALUES (?, 'free', ?, ?)")
      .run(userId, now, now);
  }

  recordToolCall(userId: string, day = todayUtc()): void {
    this.ensureAccount(userId);
    this.db
      .query(
        `INSERT INTO usage_daily (user_id, day, tool_calls) VALUES (?, ?, 1)
         ON CONFLICT(user_id, day) DO UPDATE SET tool_calls = tool_calls + 1`,
      )
      .run(userId, day);
  }

  toolCallsOn(userId: string, day = todayUtc()): number {
    const row = this.db
      .query("SELECT tool_calls FROM usage_daily WHERE user_id = ? AND day = ?")
      .get(userId, day) as { tool_calls: number } | null;
    return row?.tool_calls ?? 0;
  }

  getPlan(userId: string): string {
    const row = this.db.query("SELECT plan FROM accounts WHERE user_id = ?").get(userId) as { plan: string } | null;
    return row?.plan ?? "free";
  }

  close(): void {
    this.db.close();
  }
}

/** Total bytes of a user's database files. Cheap enough to compute on demand. */
export function userStorageBytes(userDataDir: string): number {
  if (!existsSync(userDataDir)) return 0;
  let total = 0;
  for (const name of readdirSync(userDataDir)) {
    if (!name.endsWith(".sqlite")) continue;
    try {
      total += statSync(join(userDataDir, name)).size;
    } catch {
      /* file vanished mid-scan */
    }
  }
  return total;
}

function userDatabaseCount(userDataDir: string): number {
  if (!existsSync(userDataDir)) return 0;
  return readdirSync(userDataDir).filter((n) => n.endsWith(".sqlite") && n !== "_metadata.sqlite").length;
}

export type UsageContext = {
  store: UsageStore;
  userId: string;
  userDataDir: string;
  enforce: boolean;
  /** Override for tests; defaults to the user's plan limits. */
  limits?: PlanLimits;
  /** Where the rejection message points the user (PUBLIC_BASE_URL). */
  baseUrl?: string;
};

export function checkQuota(ctx: UsageContext, tool: string): { message: string } | null {
  const plan = ctx.store.getPlan(ctx.userId);
  const limits = ctx.limits ?? PLAN_LIMITS[plan] ?? PLAN_LIMITS.free!;
  const dashboard = ctx.baseUrl ? `${ctx.baseUrl}/dashboard` : "your instant-db dashboard";

  if (ctx.store.toolCallsOn(ctx.userId) >= limits.toolCallsPerDay) {
    return {
      message: `You've hit the ${plan} plan limit of ${limits.toolCallsPerDay} instant-db tool calls today. The counter resets at midnight UTC. Manage your account at ${dashboard}.`,
    };
  }

  if (tool === "create_database" && userDatabaseCount(ctx.userDataDir) >= limits.databases) {
    return {
      message: `The ${plan} plan allows ${limits.databases} databases and you already have ${limits.databases}. Delete one, or manage your account at ${dashboard}.`,
    };
  }

  if (GROWTH_TOOLS.has(tool) && userStorageBytes(ctx.userDataDir) >= limits.storageBytes) {
    return {
      message: `You've reached the ${plan} plan storage limit of ${Math.round(limits.storageBytes / (1024 * 1024))} MB on instant-db. Reads still work; delete some data or manage your account at ${dashboard}.`,
    };
  }

  return null;
}

export function makeUsageHook(ctx: UsageContext): UsageHook {
  return {
    enforce: ctx.enforce,
    check: (tool) => checkQuota(ctx, tool),
    record: () => ctx.store.recordToolCall(ctx.userId),
  };
}
