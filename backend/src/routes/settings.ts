import { Router } from "express";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get("/", (_req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as any;
  res.json(JSON.parse(row?.value || "{}"));
});

settingsRouter.patch("/", (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as any;
  const current = JSON.parse(row?.value || "{}");
  const updated = { ...current, ...(req.body || {}) };
  db.prepare("UPDATE settings SET value = ? WHERE key = 'app'").run(JSON.stringify(updated));
  res.json(updated);
});
