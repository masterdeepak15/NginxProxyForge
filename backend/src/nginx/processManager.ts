import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { DATA_DIR } from "../db";

const NGINX_BIN = process.env.NGINX_BIN || "nginx";
const CONF_D_HTTP = path.join(DATA_DIR, "nginx", "conf.d", "http");
const CONF_D_STREAM = path.join(DATA_DIR, "nginx", "conf.d", "stream");
const BACKUPS = path.join(DATA_DIR, "backups");
const NGINX_MAIN_CONF = process.env.NGINX_MAIN_CONF || "/etc/nginx/nginx.conf";

fs.mkdirSync(CONF_D_HTTP, { recursive: true });
fs.mkdirSync(CONF_D_STREAM, { recursive: true });

let nginxProcess: ReturnType<typeof spawn> | null = null;
let starting = false;

export function confPathsForWorkflow(workflowId: string) {
  return {
    http: path.join(CONF_D_HTTP, `${workflowId}.conf`),
    stream: path.join(CONF_D_STREAM, `${workflowId}.conf`),
  };
}

// Legacy single-path accessor kept for callers that only care about the
// http fragment (e.g. deploy pipeline's "does this workflow own a file" checks).
export function confPathForWorkflow(workflowId: string) {
  return confPathsForWorkflow(workflowId).http;
}

export interface Fragments {
  http: string | null;
  stream: string | null;
}

/** Write a workflow's generated fragments to a staging area (not conf.d yet). */
export function writeStaging(workflowId: string, fragments: Fragments): { http?: string; stream?: string } {
  const stagingDir = path.join(DATA_DIR, "nginx", ".staging");
  fs.mkdirSync(stagingDir, { recursive: true });
  const out: { http?: string; stream?: string } = {};
  if (fragments.http !== null) {
    const p = path.join(stagingDir, `${workflowId}.http.conf`);
    fs.writeFileSync(p, fragments.http, "utf8");
    out.http = p;
  }
  if (fragments.stream !== null) {
    const p = path.join(stagingDir, `${workflowId}.stream.conf`);
    fs.writeFileSync(p, fragments.stream, "utf8");
    out.stream = p;
  }
  return out;
}

/**
 * Validate the whole nginx config tree (nginx -t) with this workflow's
 * fragments swapped into conf.d/http and conf.d/stream. Rolls the swap
 * back automatically if validation fails, so a bad config never lingers.
 */
export function validateConfig(
  workflowId: string,
  staging: { http?: string; stream?: string },
): { ok: boolean; output: string } {
  const targets = confPathsForWorkflow(workflowId);
  const previous = {
    http: fs.existsSync(targets.http) ? fs.readFileSync(targets.http, "utf8") : null,
    stream: fs.existsSync(targets.stream) ? fs.readFileSync(targets.stream, "utf8") : null,
  };

  if (staging.http) fs.copyFileSync(staging.http, targets.http);
  else if (fs.existsSync(targets.http)) fs.rmSync(targets.http);

  if (staging.stream) fs.copyFileSync(staging.stream, targets.stream);
  else if (fs.existsSync(targets.stream)) fs.rmSync(targets.stream);

  const result = spawnSync(NGINX_BIN, ["-t", "-c", NGINX_MAIN_CONF], { encoding: "utf8" });
  const ok = result.status === 0;
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();

  if (!ok) {
    if (previous.http !== null) fs.writeFileSync(targets.http, previous.http, "utf8");
    else if (fs.existsSync(targets.http)) fs.rmSync(targets.http);
    if (previous.stream !== null) fs.writeFileSync(targets.stream, previous.stream, "utf8");
    else if (fs.existsSync(targets.stream)) fs.rmSync(targets.stream);
  }

  return { ok, output };
}

function copyDirFlat(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  if (!fs.existsSync(src)) return;
  for (const f of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, f), path.join(dest, f));
  }
}

export function backupConfDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(BACKUPS, stamp);
  copyDirFlat(CONF_D_HTTP, path.join(dest, "http"));
  copyDirFlat(CONF_D_STREAM, path.join(dest, "stream"));
  return dest;
}

function clearDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
}

export function restoreConfDir(backupDir: string) {
  clearDir(CONF_D_HTTP);
  clearDir(CONF_D_STREAM);
  copyDirFlat(path.join(backupDir, "http"), CONF_D_HTTP);
  copyDirFlat(path.join(backupDir, "stream"), CONF_D_STREAM);
}

export function removeWorkflowConf(workflowId: string) {
  const targets = confPathsForWorkflow(workflowId);
  if (fs.existsSync(targets.http)) fs.rmSync(targets.http);
  if (fs.existsSync(targets.stream)) fs.rmSync(targets.stream);
}

export function isRunning(): boolean {
  return Boolean(nginxProcess && nginxProcess.exitCode === null);
}

export function startNginx() {
  if (starting || isRunning()) return;
  starting = true;
  nginxProcess = spawn(NGINX_BIN, ["-g", "daemon off;", "-c", NGINX_MAIN_CONF], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  nginxProcess.stdout?.on("data", (d) => process.stdout.write(`[nginx] ${d}`));
  nginxProcess.stderr?.on("data", (d) => process.stderr.write(`[nginx] ${d}`));
  nginxProcess.on("exit", (code) => {
    // eslint-disable-next-line no-console
    console.error(`[nginx] exited with code ${code}, restarting in 2s...`);
    nginxProcess = null;
    setTimeout(startNginx, 2000);
  });
  starting = false;
}

export function reloadNginx(): { ok: boolean; output: string } {
  if (!isRunning()) {
    startNginx();
    return { ok: true, output: "nginx was not running; started fresh" };
  }
  const result = spawnSync(NGINX_BIN, ["-s", "reload", "-c", NGINX_MAIN_CONF], { encoding: "utf8" });
  return { ok: result.status === 0, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
}

/** Naive TCP-connect health check against a listener port. */
export async function healthCheck(port: number, host = "127.0.0.1", timeoutMs = 3000): Promise<boolean> {
  const net = await import("net");
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}
