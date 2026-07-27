import { Router } from "express";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { validateDefaultSiteSettings, applyDefaultSiteSettings } from "../lib/defaultSite";
import { addLog } from "../logs";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get("/", (_req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as any;
  res.json(JSON.parse(row?.value || "{}"));
});

settingsRouter.patch("/", (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as any;
  const current = JSON.parse(row?.value || "{}");
  const body = { ...(req.body || {}) };

  if (body.defaultSite !== undefined) {
    const result = validateDefaultSiteSettings(body.defaultSite);
    if (!result.ok) {
      res.status(400).json({ error: { code: "invalid_default_site", message: result.error } });
      return;
    }
    body.defaultSite = result.value;
  }

  const updated = { ...current, ...body };
  db.prepare("UPDATE settings SET value = ? WHERE key = 'app'").run(JSON.stringify(updated));

  if (body.defaultSite !== undefined) {
    try {
      const applied = applyDefaultSiteSettings(body.defaultSite);
      if (!applied.ok) {
        addLog("error", null, `Default Site settings saved but nginx config test failed, reverted: ${applied.output.slice(0, 500)}`);
        res.status(207).json({ ...updated, warning: "Saved, but nginx rejected the generated config and it was reverted." });
        return;
      }
      addLog("info", null, "Default Site settings updated — reloaded nginx");
    } catch (err) {
      addLog("error", null, `Failed to apply Default Site settings: ${String(err)}`);
    }
  }

  res.json(updated);
});
