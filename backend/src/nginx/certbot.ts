import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { DATA_DIR } from "../db";

const CERTBOT_BIN = process.env.CERTBOT_BIN || "certbot";
const WEBROOT = path.join(DATA_DIR, "acme-webroot");

// Certbot defaults to writing under /etc/letsencrypt, which is NOT part of
// the /data bind mount — every issued cert would silently vanish on the
// next `docker compose up` / container recreation. Point every certbot
// invocation at directories under DATA_DIR instead, so certs, account keys,
// and renewal configs all survive container recreation exactly like the
// SQLite DB does.
const LE_ROOT = path.join(DATA_DIR, "certs", "letsencrypt");
const CONFIG_DIR = path.join(LE_ROOT, "config");
const WORK_DIR = path.join(LE_ROOT, "work");
const LOGS_DIR = path.join(LE_ROOT, "logs");
const LIVE_DIR = path.join(CONFIG_DIR, "live");

function commonDirs(): string[] {
  return ["--config-dir", CONFIG_DIR, "--work-dir", WORK_DIR, "--logs-dir", LOGS_DIR];
}

export interface IssueParams {
  domain: string;
  email: string;
  challenge: "http-01" | "dns-01";
  dnsProvider?: string;
}

export interface IssueResult {
  ok: boolean;
  certPath?: string;
  keyPath?: string;
  output: string;
}

/**
 * Runs certbot to issue a certificate. HTTP-01 uses the webroot plugin
 * (the container's nginx always serves /.well-known/acme-challenge/ from
 * WEBROOT on :80 by default — see docker/nginx.conf). DNS-01 requires the
 * relevant certbot DNS plugin to be installed in the image and its
 * credentials mounted under /data/dns-credentials.
 */
export function issueCertificate(params: IssueParams): Promise<IssueResult> {
  fs.mkdirSync(WEBROOT, { recursive: true });
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.mkdirSync(WORK_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  const args = [
    "certonly",
    ...commonDirs(),
    "--non-interactive",
    "--agree-tos",
    "--email",
    params.email,
    "-d",
    params.domain,
  ];

  if (params.challenge === "http-01") {
    args.push("--webroot", "-w", WEBROOT);
  } else {
    const provider = params.dnsProvider || "cloudflare";
    const credFile = path.join(DATA_DIR, "dns-credentials", `${provider}.ini`);
    args.push(`--dns-${provider}`, `--dns-${provider}-credentials`, credFile);
  }

  return new Promise((resolve) => {
    const child = spawn(CERTBOT_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output += d.toString()));
    child.stderr.on("data", (d) => (output += d.toString()));
    child.on("close", (code) => {
      const ok = code === 0;
      const certPath = path.join(LIVE_DIR, params.domain, "fullchain.pem");
      const keyPath = path.join(LIVE_DIR, params.domain, "privkey.pem");
      resolve({
        ok,
        certPath: ok && fs.existsSync(certPath) ? certPath : undefined,
        keyPath: ok && fs.existsSync(keyPath) ? keyPath : undefined,
        output: output.trim(),
      });
    });
    child.on("error", (err) => resolve({ ok: false, output: String(err) }));
  });
}

/**
 * Renews every certificate previously issued into CONFIG_DIR that's due
 * (certbot only actually renews certs within ~30 days of expiry; this is
 * safe to call on a schedule and is normally a no-op). Called periodically
 * by a background timer in src/index.ts and reloads nginx afterwards so
 * renewed certs actually take effect.
 */
export function renewAllCertificates(): Promise<{ ok: boolean; renewed: boolean; output: string }> {
  return new Promise((resolve) => {
    if (!fs.existsSync(CONFIG_DIR)) {
      resolve({ ok: true, renewed: false, output: "no certificates issued yet" });
      return;
    }
    const args = ["renew", ...commonDirs(), "--non-interactive", "--webroot", "-w", WEBROOT];
    const child = spawn(CERTBOT_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output += d.toString()));
    child.stderr.on("data", (d) => (output += d.toString()));
    child.on("close", (code) => {
      const renewed = /Congratulations|renewed/i.test(output);
      resolve({ ok: code === 0, renewed, output: output.trim() });
    });
    child.on("error", (err) => resolve({ ok: false, renewed: false, output: String(err) }));
  });
}

export function writeManualPem(sslNodeId: string, certPem: string, keyPem: string): { certPath: string; keyPath: string } {
  const dir = path.join(DATA_DIR, "certs", "managed", sslNodeId);
  fs.mkdirSync(dir, { recursive: true });
  const certPath = path.join(dir, "fullchain.pem");
  const keyPath = path.join(dir, "privkey.pem");
  fs.writeFileSync(certPath, certPem, "utf8");
  fs.writeFileSync(keyPath, keyPem, "utf8");
  fs.chmodSync(keyPath, 0o600);
  return { certPath, keyPath };
}