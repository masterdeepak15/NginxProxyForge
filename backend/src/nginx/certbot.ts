import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { DATA_DIR } from "../db";

const CERTBOT_BIN = process.env.CERTBOT_BIN || "certbot";
const WEBROOT = path.join(DATA_DIR, "acme-webroot");
const LE_DIR = "/etc/letsencrypt/live";

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
 * Runs certbot to issue/renew a certificate. HTTP-01 uses the webroot plugin
 * (nginx must be serving /.well-known/acme-challenge/ from WEBROOT for the
 * domain in question). DNS-01 requires the relevant certbot DNS plugin to be
 * installed in the image and its credentials mounted under /data/dns-credentials.
 */
export function issueCertificate(params: IssueParams): Promise<IssueResult> {
  fs.mkdirSync(WEBROOT, { recursive: true });

  const args = [
    "certonly",
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
      const certPath = path.join(LE_DIR, params.domain, "fullchain.pem");
      const keyPath = path.join(LE_DIR, params.domain, "privkey.pem");
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
