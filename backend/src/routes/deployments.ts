import { Router } from "express";
import { db } from "../db";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { rollbackDeployment } from "../nginx/deployPipeline";

export const deploymentsRouter = Router();
deploymentsRouter.use(requireAuth);

function rowToDeployment(row: any, includeLogs = false) {
  const out: any = {
    id: row.id,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    version: row.version,
    status: row.status,
    author: row.author,
    timestamp: row.timestamp,
    durationMs: row.duration_ms,
  };
  if (includeLogs) out.logs = JSON.parse(row.logs || "[]");
  return out;
}

deploymentsRouter.get("/", (req, res) => {
  const { workflowId, status, limit } = req.query;
  let sql = "SELECT * FROM deployments WHERE 1=1";
  const params: any[] = [];
  if (workflowId) {
    sql += " AND workflow_id = ?";
    params.push(workflowId);
  }
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  sql += " ORDER BY timestamp DESC";
  if (limit) {
    sql += " LIMIT ?";
    params.push(Number(limit));
  }
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map((r) => rowToDeployment(r)));
});

deploymentsRouter.get("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM deployments WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: "not_found", message: "Deployment not found" } });
  res.json(rowToDeployment(row, true));
});

deploymentsRouter.post("/:id/rollback", async (req: AuthedRequest, res) => {
  const author = (db.prepare("SELECT name FROM users WHERE id = ?").get(req.userId ?? null) as any)?.name || "system";
  const dep = await rollbackDeployment(req.params.id, author);
  if (!dep) return res.status(404).json({ error: { code: "not_found", message: "Deployment or snapshot not found" } });
  res.status(202).json(dep);
});
