import "dotenv/config";
import express from "express";
import cors from "cors";
import { db, DATA_DIR } from "./db";
import { authRouter } from "./routes/auth";
import { workflowsRouter } from "./routes/workflows";
import { deploymentsRouter } from "./routes/deployments";
import { certificatesRouter } from "./routes/certificates";
import { metricsRouter } from "./routes/metrics";
import { logsRouter } from "./routes/logs";
import { settingsRouter } from "./routes/settings";
import { startNginx, reloadNginx } from "./nginx/processManager";
import { renewAllCertificates } from "./nginx/certbot";
import { addLog } from "./logs";

const app = express();
// Internal port only \u2014 the container's real nginx (see docker/nginx.conf)
// reverse-proxies the public admin-dashboard port (81) to this server's
// /api/* routes, and to the frontend UI server for everything else.
const PORT = Number(process.env.PORT || 3001);

app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/api/auth", authRouter);
app.use("/api/workflows", workflowsRouter);
app.use("/api/deployments", deploymentsRouter);
app.use("/api/certificates", certificatesRouter);
app.use("/api/metrics", metricsRouter);
app.use("/api/logs", logsRouter);
app.use("/api/settings", settingsRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: { code: "internal_error", message: err?.message || "Internal error" } });
});

void db; // ensure db module (and its first-boot seeding) is initialized

// This process is PID 1 inside the container (see docker/entrypoint.sh) and
// owns the real nginx binary as a child process: starts it, validates every
// generated config with `nginx -t` before reloading, and restarts it if it
// exits unexpectedly. See src/nginx/processManager.ts and deployPipeline.ts.
startNginx();

// Automatic certificate renewal. `certbot renew` only actually renews certs
// within ~30 days of expiry, so this is safe to run frequently \u2014 it's a
// no-op most of the time. Runs once shortly after boot (catches anything
// that expired while the container was down) and then every 12h.
const RENEWAL_INTERVAL_MS = Number(process.env.RENEWAL_INTERVAL_MS || 12 * 60 * 60 * 1000);
async function runRenewalCheck() {
  try {
    const result = await renewAllCertificates();
    if (result.renewed) {
      addLog("info", null, "Certbot renewed one or more certificates \u2014 reloading nginx");
      reloadNginx();
    } else if (!result.ok) {
      addLog("warn", null, `Certificate renewal check failed: ${result.output.slice(0, 500)}`);
    }
  } catch (err) {
    addLog("error", null, `Certificate renewal check threw: ${String(err)}`);
  }
}
setTimeout(runRenewalCheck, 60_000);
setInterval(runRenewalCheck, RENEWAL_INTERVAL_MS);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`ProxyForge API listening on :${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});