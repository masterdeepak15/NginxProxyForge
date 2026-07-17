import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { issueCertificate, writeManualPem } from "../nginx/certbot";

export const certificatesRouter = Router();
certificatesRouter.use(requireAuth);

function certStatus(expiresAt: string | null): "valid" | "expiring" | "expired" {
  if (!expiresAt) return "valid";
  const days = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return "expired";
  if (days < 21) return "expiring";
  return "valid";
}

function rowToCert(row: any) {
  return {
    id: row.id,
    domain: row.domain,
    issuer: row.issuer,
    expiresAt: row.expires_at,
    status: certStatus(row.expires_at),
  };
}

certificatesRouter.get("/", (_req, res) => {
  const rows = db.prepare("SELECT * FROM certificates ORDER BY created_at DESC").all();
  res.json(rows.map(rowToCert));
});

certificatesRouter.post("/lets-encrypt", (req, res) => {
  const { domain, challenge, dnsProvider, email } = req.body || {};
  if (!domain || !email) {
    return res.status(400).json({ error: { code: "bad_request", message: "domain and email are required" } });
  }
  const jobId = `job_${randomUUID().slice(0, 8)}`;
  db.prepare(`INSERT INTO acme_jobs (id, domain, status) VALUES (?,?,?)`).run(jobId, domain, "pending");
  res.status(202).json({ jobId });

  // Fire and forget — client polls GET /certificates/lets-encrypt/:jobId
  issueCertificate({ domain, email, challenge: challenge || "http-01", dnsProvider })
    .then((result) => {
      if (result.ok && result.certPath && result.keyPath) {
        const certId = `c_${randomUUID().slice(0, 8)}`;
        const expiresAt = new Date(Date.now() + 90 * 86_400_000).toISOString(); // LE certs are 90d
        db.prepare(
          `INSERT INTO certificates (id, domain, issuer, expires_at, status, challenge, dns_provider, cert_path, key_path, managed)
           VALUES (?,?,?,?,?,?,?,?,?,1)`,
        ).run(certId, domain, "Let's Encrypt", expiresAt, "valid", challenge || "http-01", dnsProvider || null, result.certPath, result.keyPath);
        db.prepare(`UPDATE acme_jobs SET status='issued', certificate_id=? WHERE id=?`).run(certId, jobId);
      } else {
        db.prepare(`UPDATE acme_jobs SET status='error', error=? WHERE id=?`).run(result.output.slice(0, 2000), jobId);
      }
    })
    .catch((err) => {
      db.prepare(`UPDATE acme_jobs SET status='error', error=? WHERE id=?`).run(String(err), jobId);
    });
});

certificatesRouter.get("/lets-encrypt/:jobId", (req, res) => {
  const row = db.prepare("SELECT * FROM acme_jobs WHERE id = ?").get(req.params.jobId) as any;
  if (!row) return res.status(404).json({ error: { code: "not_found", message: "Job not found" } });
  let certPath: string | undefined;
  let keyPath: string | undefined;
  let expiresAt: string | undefined;
  if (row.certificate_id) {
    const cert = db.prepare("SELECT * FROM certificates WHERE id = ?").get(row.certificate_id) as any;
    if (cert) {
      certPath = cert.cert_path;
      keyPath = cert.key_path;
      expiresAt = cert.expires_at;
    }
  }
  res.json({
    status: row.status,
    error: row.error || undefined,
    certificateId: row.certificate_id || undefined,
    certPath,
    keyPath,
    expiresAt,
  });
});

certificatesRouter.post("/", (req, res) => {
  const { domain, certPem, keyPem } = req.body || {};
  if (!domain || !certPem || !keyPem) {
    return res.status(400).json({ error: { code: "bad_request", message: "domain, certPem, keyPem are required" } });
  }
  const certId = `c_${randomUUID().slice(0, 8)}`;
  const { certPath, keyPath } = writeManualPem(certId, certPem, keyPem);
  db.prepare(
    `INSERT INTO certificates (id, domain, issuer, expires_at, status, cert_path, key_path, managed)
     VALUES (?,?,?,?,?,?,?,0)`,
  ).run(certId, domain, "Imported", null, "valid", certPath, keyPath);
  res.status(201).json(rowToCert({ id: certId, domain, issuer: "Imported", expires_at: null }));
});

certificatesRouter.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM certificates WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: "not_found", message: "Certificate not found" } });
  db.prepare("DELETE FROM certificates WHERE id = ?").run(req.params.id);
  res.status(204).end();
});
