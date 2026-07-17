import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getTrafficSeries, getStats, getNodeStats } from "../metrics";

export const metricsRouter = Router();
metricsRouter.use(requireAuth);

metricsRouter.get("/traffic", (req, res) => {
  const range = (req.query.range as any) || "24h";
  const workflowId = req.query.workflowId as string | undefined;
  res.json(getTrafficSeries(range, workflowId));
});

metricsRouter.get("/stats", (_req, res) => {
  res.json(getStats());
});

metricsRouter.get("/nodes/:nodeId", (req, res) => {
  const range = (req.query.range as string) || "min";
  res.json(getNodeStats(req.params.nodeId, range));
});
