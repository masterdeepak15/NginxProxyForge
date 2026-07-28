import { Router } from "express";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";

export const logsRouter = Router();
logsRouter.use(requireAuth);

// SQLite's datetime('now') stores UTC as "YYYY-MM-DD HH:MM:SS" with no
// timezone marker. Parsed with `new Date(...)` on the client that string
// is ambiguous (some engines treat the space-separated form as local
// time), silently shifting every logged time by the browser's UTC offset.
// Normalize to a proper ISO-8601 UTC string ("...T...Z") before it ever
// leaves the API so the frontend can safely convert it to the viewer's
// local timezone for display.
function toIsoUtc(ts: string): string {
  if (!ts) return ts;
  if (ts.includes("T") && (ts.endsWith("Z") || /[+-]\d\d:\d\d$/.test(ts))) return ts;
  return `${ts.replace(" ", "T")}Z`;
}

const MAX_PAGE_SIZE = 200;

logsRouter.get("/", (req, res) => {
  const { workflowId, level, from, to, q } = req.query;

  // `page`/`pageSize` drive server-side pagination for the Logs page.
  // `limit` (legacy, uncapped-by-page single fetch) is still honored for
  // any other caller that just wants "the last N entries".
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 50));
  const useLegacyLimit = req.query.page === undefined && req.query.pageSize === undefined;

  let where = " WHERE 1=1";
  const params: any[] = [];
  if (workflowId) {
    where += " AND workflow_id = ?";
    params.push(workflowId);
  }
  if (level) {
    where += " AND level = ?";
    params.push(level);
  }
  if (from) {
    where += " AND ts >= ?";
    params.push(from);
  }
  if (to) {
    where += " AND ts <= ?";
    params.push(to);
  }
  if (q) {
    where += " AND (message LIKE ? OR workflow_id LIKE ?)";
    params.push(`%${q}%`, `%${q}%`);
  }

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM log_entries${where}`).get(...params) as {
    c: number;
  }).c;

  let sql = `SELECT * FROM log_entries${where} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`;
  const limitVal = useLegacyLimit ? Number(req.query.limit) || 200 : pageSize;
  const offsetVal = useLegacyLimit ? 0 : (page - 1) * pageSize;
  const rows = db.prepare(sql).all(...params, limitVal, offsetVal) as any[];

  const data = rows.map((r) => ({
    ts: toIsoUtc(r.ts),
    level: r.level,
    workflowId: r.workflow_id || undefined,
    message: r.message,
  }));

  if (useLegacyLimit) {
    // Backwards-compatible shape: a bare array.
    res.json(data);
  } else {
    res.json({ data, total, page, pageSize });
  }
});

// Server-Sent Events stream of new log entries (polls the DB every 2s for simplicity).
logsRouter.get("/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  let lastId = 0;
  const initial = db.prepare("SELECT MAX(id) as id FROM log_entries").get() as any;
  lastId = initial?.id || 0;

  const interval = setInterval(() => {
    const rows = db.prepare("SELECT * FROM log_entries WHERE id > ? ORDER BY id ASC").all(lastId) as any[];
    for (const r of rows) {
      lastId = r.id;
      res.write(`data: ${JSON.stringify({ ts: toIsoUtc(r.ts), level: r.level, workflowId: r.workflow_id, message: r.message })}\n\n`);
    }
  }, 2000);

  req.on("close", () => clearInterval(interval));
});
