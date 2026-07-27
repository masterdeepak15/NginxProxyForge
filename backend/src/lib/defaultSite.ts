import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { DATA_DIR, db } from "../db";
import { reloadNginx } from "../nginx/processManager";

// Global "what does nginx serve when no Domain matches" page, configured
// from Settings rather than as a workflow node. See docker/nginx.conf's
// base fallback server{} block (:80, no explicit default_server — see the
// comment there) which `include`s the file this module generates.
//
// Modeling this as a per-Listener graph node (an earlier iteration) made
// it possible to create a real conflict: nginx rejects two default_server
// blocks on the same address:port, and the base fallback block already
// claims that role. A single global setting sidesteps that entirely.

const CONF_PATH = path.join(DATA_DIR, "nginx", "conf.d", "default-site.conf");
const NGINX_BIN = process.env.NGINX_BIN || "nginx";
const NGINX_MAIN_CONF = process.env.NGINX_MAIN_CONF || "/etc/nginx/nginx.conf";

export type DefaultSiteMode = "congratulations" | "404" | "no-response" | "redirect" | "custom";

export interface DefaultSiteSettings {
  mode: DefaultSiteMode;
  redirectUrl: string;
  redirectCode: "301" | "302";
  html: string;
}

const CONGRATULATIONS_HTML =
  "<!DOCTYPE html><html><head><meta charset='utf-8'><title>ProxyForge</title>" +
  "<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;" +
  "align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont," +
  "'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#0f172a,#1e293b);" +
  "color:#e2e8f0;padding:24px}.card{max-width:520px;text-align:center;padding:48px 40px;" +
  "border-radius:16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08)}" +
  ".badge{display:inline-block;padding:4px 12px;border-radius:999px;" +
  "background:rgba(99,102,241,.15);color:#a5b4fc;font-size:.75rem;font-weight:600;" +
  "letter-spacing:.05em;text-transform:uppercase;margin-bottom:16px}" +
  "h1{margin:0 0 12px;font-size:1.75rem}p{margin:0 0 8px;color:#94a3b8;line-height:1.6}" +
  "code{background:rgba(255,255,255,.06);padding:2px 6px;border-radius:4px;font-size:.85em}" +
  "</style></head><body><div class='card'><span class='badge'>ProxyForge</span>" +
  "<h1>It's running.</h1><p>No proxy host matches this request yet.</p>" +
  "<p>Open the dashboard on port <code>81</code> to create your first workflow.</p>" +
  "</div></body></html>";

const NOT_FOUND_HTML =
  "<!DOCTYPE html><html><head><meta charset='utf-8'><title>404 Not Found</title>" +
  "<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;" +
  "display:flex;align-items:center;justify-content:center;height:100vh;margin:0}" +
  ".box{text-align:center}h1{font-size:2.5rem;margin-bottom:.5rem}p{color:#94a3b8}" +
  "</style></head><body><div class='box'><h1>404</h1>" +
  "<p>Nothing here matches that request.</p></div></body></html>";

export const DEFAULT_SITE_DEFAULTS: DefaultSiteSettings = {
  mode: "congratulations",
  redirectUrl: "",
  redirectCode: "302",
  html: '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n<title>Welcome</title>\n</head>\n<body>\n  <h1>Welcome</h1>\n  <p>Replace this with your own content, or upload an HTML file.</p>\n</body>\n</html>\n',
};

// Same escaping rule as the (now-removed) per-node generator used: nginx's
// return/add_header "complex value" strings interpolate $variables, so a
// literal `$` in user-supplied HTML (common in inline JS) needs escaping
// or it'll silently get mangled or fail config validation.
function escapeNginxDoubleQuoted(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$");
}

export function getDefaultSiteSettings(): DefaultSiteSettings {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined;
  const app = JSON.parse(row?.value || "{}");
  return { ...DEFAULT_SITE_DEFAULTS, ...(app.defaultSite || {}) };
}

export function validateDefaultSiteSettings(
  input: unknown,
): { ok: true; value: DefaultSiteSettings } | { ok: false; error: string } {
  const modes: DefaultSiteMode[] = ["congratulations", "404", "no-response", "redirect", "custom"];
  const i = (input || {}) as Record<string, unknown>;
  const mode = modes.includes(i.mode as DefaultSiteMode) ? (i.mode as DefaultSiteMode) : DEFAULT_SITE_DEFAULTS.mode;
  const redirectCode = i.redirectCode === "301" ? "301" : "302";
  const redirectUrl = typeof i.redirectUrl === "string" ? i.redirectUrl : "";
  const html = typeof i.html === "string" ? i.html : "";
  if (mode === "redirect" && !redirectUrl.trim()) {
    return { ok: false, error: "Redirect URL is required when mode is Redirect" };
  }
  return { ok: true, value: { mode, redirectCode, redirectUrl, html } };
}

function contentLines(s: DefaultSiteSettings): string[] {
  if (s.mode === "no-response") return ["    return 444;"];
  if (s.mode === "redirect") {
    return [`    return ${s.redirectCode} "${escapeNginxDoubleQuoted(s.redirectUrl)}";`];
  }
  const lines = ["    default_type text/html;"];
  if (s.mode === "404") {
    lines.push(`    return 404 "${escapeNginxDoubleQuoted(NOT_FOUND_HTML)}";`);
  } else if (s.mode === "custom") {
    lines.push(`    return 200 "${escapeNginxDoubleQuoted(s.html)}";`);
  } else {
    lines.push(`    return 200 "${escapeNginxDoubleQuoted(CONGRATULATIONS_HTML)}";`);
  }
  return lines;
}

export function generateDefaultSiteConf(s: DefaultSiteSettings): string {
  return [
    "# Generated by ProxyForge from Settings \u2192 Default Site \u2014 do not hand-edit.",
    "location / {",
    ...contentLines(s),
    "}",
    "",
  ].join("\n");
}

function writeConfFile(s: DefaultSiteSettings): void {
  fs.mkdirSync(path.dirname(CONF_PATH), { recursive: true });
  fs.writeFileSync(CONF_PATH, generateDefaultSiteConf(s), "utf8");
}

/**
 * Validate-then-apply: writes the new content, runs `nginx -t`, and rolls
 * back to whatever was there before if validation fails — so a bad
 * Default Site setting (in practice, essentially unreachable given
 * validateDefaultSiteSettings already constrains the shape, but the same
 * safety net every other config write in this app gets) can never break
 * the fallback nginx depends on for :80 entirely.
 */
export function applyDefaultSiteSettings(s: DefaultSiteSettings): { ok: boolean; output: string } {
  const previous = fs.existsSync(CONF_PATH) ? fs.readFileSync(CONF_PATH, "utf8") : null;
  writeConfFile(s);

  const result = spawnSync(NGINX_BIN, ["-t", "-c", NGINX_MAIN_CONF], { encoding: "utf8" });
  const ok = result.status === 0;
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();

  if (!ok) {
    if (previous !== null) fs.writeFileSync(CONF_PATH, previous, "utf8");
    else if (fs.existsSync(CONF_PATH)) fs.rmSync(CONF_PATH);
    return { ok: false, output };
  }

  reloadNginx();
  return { ok: true, output };
}

/**
 * Called once at boot, before nginx starts (see index.ts) — the base
 * nginx.conf `include`s this file unconditionally, so it must exist (even
 * on a completely fresh /data volume) or nginx fails to start entirely.
 * Always regenerates from the current settings (not just "if missing"),
 * so a restored/edited DB stays the source of truth.
 */
export function syncDefaultSiteConf(): void {
  writeConfFile(getDefaultSiteSettings());
}
