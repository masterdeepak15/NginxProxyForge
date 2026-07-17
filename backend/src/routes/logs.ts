import { Router } from "express";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";

export const logsRouter = Router();
logsRouter.use(requireAuth);

logsRouter.get("/", (req, res) => {
  const { workflowId, level, limit, from, to } = req.query;
  let sql = "SELECT * FROM log_entries WHERE 1=1";
  const params: any[] = [];
  if (workflowId) {
    sql += " AND workflow_id = ?";
    params.push(workflowId);
  }
  if (level) {
    sql += " AND level = ?";
    params.push(level);
  }
  if (from) {
    sql += " AND ts >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND ts <= ?";
    params.push(to);
  }
  sql += " ORDER BY ts DESC LIMIT ?";
  params.push(limit ? Number(limit) : 200);
  const rows = db.prepare(sql).all(...params) as any[];
  res.json(
    rows.map((r) => ({
      ts: r.ts,
      level: r.level,
      workflowId: r.workflow_id || undefined,
      message: r.message,
    })),
  );
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
      res.write(`data: ${JSON.stringify({ ts: r.ts, level: r.level, workflowId: r.workflow_id, message: r.message })}\n\n`);
    }
  }, 2000);

  req.on("close", () => clearInterval(interval));
});
