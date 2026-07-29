import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getTrafficSeries, getStats, getNodeStats, getDomainStats, getRecentErrors } from "../metrics";

export const metricsRouter = Router();
metricsRouter.use(requireAuth);

metricsRouter.get("/traffic", (req, res) => {
  const range = (req.query.range as any) || "24h";
  const workflowId = req.query.workflowId as string | undefined;
  res.json(getTrafficSeries(range, workflowId));
});

metricsRouter.get("/domains", (req, res) => {
  const range = (req.query.range as any) || "24h";
  const limit = req.query.limit ? Number(req.query.limit) : 10;
  res.json(getDomainStats(range, limit));
});

metricsRouter.get("/errors", (req, res) => {
  const range = (req.query.range as any) || "24h";
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
  res.json(getRecentErrors(range, { page, pageSize }));
});

metricsRouter.get("/stats", (_req, res) => {
  res.json(getStats());
});

metricsRouter.get("/nodes/:nodeId", (req, res) => {
  const range = (req.query.range as string) || "min";
  res.json(getNodeStats(req.params.nodeId, range));
});
