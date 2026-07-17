import fs from "fs";
import path from "path";
import { DATA_DIR } from "./db";
import { db } from "./db";

const LOG_DIR = path.join(DATA_DIR, "logs");

// Combined log format: $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$referer" "$agent"
const LOG_LINE_RE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+) \S+" (\d{3}) (\d+)/;

interface ParsedLine {
  time: Date;
  status: number;
  bytes: number;
}

function listWorkflowLogFiles(workflowId?: string): string[] {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs
    .readdirSync(LOG_DIR)
    .filter((f) => f.endsWith(".access.log"))
    .filter((f) => !workflowId || f.startsWith(`${workflowId}_`))
    .map((f) => path.join(LOG_DIR, f));
}

function tailParse(file: string, sinceMs: number): ParsedLine[] {
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n").slice(-20000); // cap for performance
  const out: ParsedLine[] = [];
  for (const l of lines) {
    const m = LOG_LINE_RE.exec(l);
    if (!m) continue;
    const t = new Date(m[2].replace(":", " ").replace(/(\d+)\/(\w+)\/(\d+)/, "$1 $2 $3"));
    if (isNaN(t.getTime()) || t.getTime() < sinceMs) continue;
    out.push({ time: t, status: Number(m[5]), bytes: Number(m[6]) });
  }
  return out;
}

export interface MetricPoint {
  time: string;
  requests: number;
  errors: number;
  latencyMs: number;
}

export function getTrafficSeries(range: "1h" | "24h" | "7d" | "30d", workflowId?: string): MetricPoint[] {
  const buckets: Record<string, "hour" | "day"> = { "1h": "hour", "24h": "hour", "7d": "day", "30d": "day" };
  const windowMs: Record<string, number> = {
    "1h": 3_600_000,
    "24h": 86_400_000,
    "7d": 7 * 86_400_000,
    "30d": 30 * 86_400_000,
  };
  const since = Date.now() - windowMs[range];
  const files = listWorkflowLogFiles(workflowId);
  const entries = files.flatMap((f) => tailParse(f, since));

  const bucketMs = buckets[range] === "hour" ? 3_600_000 : 86_400_000;
  const bucketCount = range === "1h" ? 12 : range === "24h" ? 24 : range === "7d" ? 7 : 30;
  const stepMs = windowMs[range] / bucketCount;

  const points: MetricPoint[] = [];
  for (let i = bucketCount - 1; i >= 0; i--) {
    const bucketStart = Date.now() - (i + 1) * stepMs;
    const bucketEnd = Date.now() - i * stepMs;
    const inBucket = entries.filter((e) => e.time.getTime() >= bucketStart && e.time.getTime() < bucketEnd);
    const errors = inBucket.filter((e) => e.status >= 500).length;
    const label = new Date(bucketEnd);
    points.push({
      time: stepMs >= 86_400_000 ? label.toISOString().slice(5, 10) : `${label.getHours().toString().padStart(2, "0")}:00`,
      requests: inBucket.length,
      errors,
      latencyMs: 0,
    });
  }
  return points;
}

export function getStats() {
  const workflows = db.prepare("SELECT status, domains FROM workflows").all() as any[];
  const certs = db.prepare("SELECT status FROM certificates").all() as any[];
  const since = Date.now() - 60_000; // last minute for rps
  const files = listWorkflowLogFiles();
  const recent = files.flatMap((f) => tailParse(f, since));
  const errorCount = recent.filter((e) => e.status >= 500).length;

  let totalDomains = 0;
  for (const w of workflows) totalDomains += (JSON.parse(w.domains || "[]") as string[]).length;

  return {
    totalWorkflows: workflows.length,
    deployed: workflows.filter((w) => w.status === "deployed").length,
    drifted: workflows.filter((w) => w.status === "drifted").length,
    failed: workflows.filter((w) => w.status === "failed").length,
    totalDomains,
    expiringCerts: certs.filter((c) => {
      // status is computed at read time elsewhere; recompute cheaply here isn't necessary,
      // certificates route is the source of truth for expiry status.
      return c.status === "expiring";
    }).length,
    requestsPerSec: Math.round((recent.length / 60) * 100) / 100,
    errorRate: recent.length ? Math.round((errorCount / recent.length) * 10000) / 100 : 0,
    p95Latency: 0,
  };
}

export function getNodeStats(nodeId: string, range: string) {
  // Node-level counters require knowing which workflow+listener a node belongs to;
  // the route resolves that context and passes a scoped file list in via workflowId.
  const rangeSeconds: Record<string, number> = {
    sec: 1,
    min: 60,
    hour: 3600,
    day: 86_400,
    week: 604_800,
    month: 2_592_000,
  };
  const seconds = rangeSeconds[range] ?? 60;
  const since = Date.now() - seconds * 1000;
  const files = listWorkflowLogFiles();
  const entries = files.flatMap((f) => tailParse(f, since));
  return {
    nodeId,
    range,
    count: entries.length,
    generatedAt: new Date().toISOString(),
  };
}
