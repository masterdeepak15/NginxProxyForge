import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";

const DATA_DIR = process.env.DATA_DIR || "/data";
const DB_PATH = path.join(DATA_DIR, "db", "proxyforge.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
for (const sub of ["nginx/conf.d/http", "nginx/conf.d/stream", "certs", "backups", "logs"]) {
  fs.mkdirSync(path.join(DATA_DIR, sub), { recursive: true });
}

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator',
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  domains TEXT NOT NULL DEFAULT '[]',
  nodes TEXT NOT NULL DEFAULT '[]',
  edges TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'system',
  message TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  workflow_name TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  author TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  duration_ms INTEGER NOT NULL DEFAULT 0,
  logs TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  issuer TEXT NOT NULL,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'valid',
  challenge TEXT,
  dns_provider TEXT,
  cert_path TEXT,
  key_path TEXT,
  managed INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acme_jobs (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  certificate_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS log_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  level TEXT NOT NULL DEFAULT 'info',
  workflow_id TEXT,
  message TEXT NOT NULL
);
`);

// ---- first-boot seeding ----
const userCount = (db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
if (userCount === 0) {
  const genPassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    let out = "";
    for (let i = 0; i < 16; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  };
  const password = process.env.ADMIN_INITIAL_PASSWORD || genPassword();
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, must_change_password) VALUES (?,?,?,?,?,?)`,
  ).run("u_admin", process.env.ADMIN_EMAIL || "admin@proxyforge.local", hash, "Administrator", "admin", 1);

  // eslint-disable-next-line no-console
  console.log("================================================================");
  console.log(" ProxyForge — first boot admin account created");
  console.log(` Email:    ${process.env.ADMIN_EMAIL || "admin@proxyforge.local"}`);
  console.log(` Password: ${password}`);
  console.log(" You will be required to change this password on first login.");
  console.log("================================================================");
}

if (!db.prepare("SELECT 1 FROM settings WHERE key = 'app'").get()) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('app', ?)").run(
    JSON.stringify({
      theme: "dark",
      defaultProvider: "letsencrypt",
      notifications: { certExpiry: true, deployFailure: true },
    }),
  );
}

export { DATA_DIR };
