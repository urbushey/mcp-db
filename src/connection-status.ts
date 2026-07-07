/**
 * Tracks when a user's Claude client last made an authenticated MCP request.
 * Hosting-layer only — the marker is a dotfile so it never shows up in the
 * DatabaseRegistry's *.sqlite listing, and it stays out of exported data.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MARKER_FILE = ".mcp-last-seen";

export function recordMcpSeen(dataDir: string): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, MARKER_FILE), String(Date.now()));
  } catch {
    // Tracking must never fail a real MCP request.
  }
}

export function readMcpLastSeen(dataDir: string): number | null {
  try {
    const ts = Number(readFileSync(join(dataDir, MARKER_FILE), "utf-8").trim());
    return Number.isFinite(ts) && ts > 0 ? ts : null;
  } catch {
    return null;
  }
}
