/**
 * Personal access tokens: long-lived bearer tokens for headless MCP clients
 * that can't complete a browser OAuth login. A token resolves to the same
 * subject as the user's OAuth session, so it sees the same data directory.
 *
 * Only a sha256 hash of each token is stored, in the control-plane database
 * (DATA_DIR/_accounts.sqlite) next to the usage meter.
 */
import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const PAT_PREFIX = "mcpdb_pat_";

export function isPersonalAccessToken(token: string): boolean {
  return token.startsWith(PAT_PREFIX);
}

function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

export type PatInfo = {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
};

type PatRow = {
  id: string;
  subject: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
};

function toInfo(row: PatRow): PatInfo {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export class PatStore {
  private db: Database;

  constructor(rootDataDir: string) {
    mkdirSync(rootDataDir, { recursive: true });
    this.db = new Database(join(rootDataDir, "_accounts.sqlite"));
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS personal_access_tokens (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        subject TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        expires_at INTEGER,
        revoked_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS personal_access_tokens_subject ON personal_access_tokens (subject);
    `);
  }

  /** Mints a token. The plaintext is returned once and never stored. */
  create(opts: { subject: string; name: string; expiresAt?: number }): { id: string; token: string } {
    const id = randomBytes(6).toString("hex");
    const token = PAT_PREFIX + randomBytes(32).toString("base64url");
    this.db
      .query(
        `INSERT INTO personal_access_tokens (id, token_hash, subject, name, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, hashToken(token), opts.subject, opts.name, Date.now(), opts.expiresAt ?? null);
    return { id, token };
  }

  /** Returns the owning subject for a live token, or null if unknown, revoked or expired. */
  verify(token: string): { subject: string; id: string } | null {
    const row = this.db
      .query("SELECT * FROM personal_access_tokens WHERE token_hash = ?")
      .get(hashToken(token)) as PatRow | null;
    if (!row || row.revoked_at !== null) return null;

    const now = Date.now();
    if (row.expires_at !== null && row.expires_at <= now) return null;

    this.db.query("UPDATE personal_access_tokens SET last_used_at = ? WHERE id = ?").run(now, row.id);
    return { subject: row.subject, id: row.id };
  }

  list(subject: string): PatInfo[] {
    const rows = this.db
      .query("SELECT * FROM personal_access_tokens WHERE subject = ? ORDER BY created_at DESC")
      .all(subject) as PatRow[];
    return rows.map(toInfo);
  }

  /** Revokes one token. Returns false if the subject doesn't own a live token with that id. */
  revoke(subject: string, id: string): boolean {
    const result = this.db
      .query("UPDATE personal_access_tokens SET revoked_at = ? WHERE id = ? AND subject = ? AND revoked_at IS NULL")
      .run(Date.now(), id, subject);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
