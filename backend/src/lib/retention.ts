import fs from "fs";
import path from "path";
import { DATA_DIR, db } from "../db";
import { addLog } from "../logs";

const LOG_DIR = path.join(DATA_DIR, "logs");
const CACHE_ROOT = "/var/cache/nginx";

export interface RetentionSettings {
  days: number;
}

export const RETENTION_DEFAULTS: RetentionSettings = { days: 30 };

export function getRetentionSettings(): RetentionSettings {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined;
  const app = JSON.parse(row?.value || "{}");
  const days = Number(app.retention?.days);
  return { days: Number.isFinite(days) && days > 0 ? Math.floor(days) : RETENTION_DEFAULTS.days };
}

export function validateRetentionSettings(
  input: unknown,
): { ok: true; value: RetentionSettings } | { ok: false; error: string } {
  const i = (input || {}) as Record<string, unknown>;
  const days = Number(i.days);
  if (!Number.isFinite(days) || days < 1 || days > 3650) {
    return { ok: false, error: "Retention days must be a number between 1 and 3650" };
  }
  return { ok: true, value: { days: Math.floor(days) } };
}

function removeOldFiles(dir: string, cutoffMs: number, matches: (name: string) => boolean): number {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!matches(name)) continue;
    const full = path.join(dir, name);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile() && stat.mtimeMs < cutoffMs) {
        fs.rmSync(full);
        removed++;
      }
    } catch {
      // Concurrently removed, or not a plain file - skip it.
    }
  }
  return removed;
}

// nginx's own `proxy_cache_path ... inactive=<duration>` (set per Cache
// node) already reclaims entries nginx's cache *manager* process hasn't
// touched in a while, but that's activity-based, not calendar-based, and
// only runs while nginx itself is up. This is a broader belt-and-braces
// sweep of anything genuinely stale on disk, not a replacement for it.
function removeOldCacheEntries(cutoffMs: number): number {
  if (!fs.existsSync(CACHE_ROOT)) return 0;
  let removed = 0;
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoffMs) {
          fs.rmSync(full);
          removed++;
        }
      } catch {
        // skip
      }
    }
  };
  for (const zone of fs.readdirSync(CACHE_ROOT)) {
    walk(path.join(CACHE_ROOT, zone));
  }
  return removed;
}

/**
 * Deletes, based on the configured retention window (default 30 days,
 * see Settings): per-domain access/error log files past their age, DB log
 * rows (log_entries) past their age, and stale nginx proxy cache files.
 * Only ever compares against file mtime / row timestamp - never touches
 * anything newer than the window. Safe to call repeatedly/concurrently
 * with normal operation.
 */
export function runRetentionCleanup(): void {
  const { days } = getRetentionSettings();
  const cutoffMs = Date.now() - days * 86_400_000;

  const removedLogs = removeOldFiles(
    LOG_DIR,
    cutoffMs,
    (name) => name.endsWith(".access.log") || name.endsWith(".error.log"),
  );
  const removedCache = removeOldCacheEntries(cutoffMs);
  const dbResult = db.prepare("DELETE FROM log_entries WHERE ts < datetime('now', ?)").run(`-${days} days`);

  if (removedLogs || removedCache || dbResult.changes) {
    addLog(
      "info",
      null,
      `Retention cleanup: removed ${removedLogs} log file(s), ${removedCache} cache file(s), ${dbResult.changes} DB log row(s) older than ${days}d`,
    );
  }
}
