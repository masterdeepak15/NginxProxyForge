import fs from "fs";
import path from "path";
import { DATA_DIR, db } from "./db";
import type { Workflow, WorkflowNode } from "./types";
import { computeNodeScopes, domainsForListener, domainLogFile, locationLogFile } from "./lib/graphScope";

const LOG_DIR = path.join(DATA_DIR, "logs");

// Matches the "pf" log_format defined in docker/nginx.conf:
// $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent
// "$http_referer" "$http_user_agent" up=$upstream_addr rt=$request_time
const LOG_LINE_RE =
  /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+) \S+" (\d{3}) (\d+) "[^"]*" "[^"]*" up=(\S*) rt=(\S*)/;

interface ParsedLine {
  time: Date;
  status: number;
  bytes: number;
  upstream: string | null;
  requestTimeMs: number | null;
}

function listAllAccessLogFiles(): string[] {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR).filter((f) => f.endsWith(".access.log"));
}

function tailParse(fileName: string, sinceMs: number): ParsedLine[] {
  const full = path.join(LOG_DIR, fileName);
  if (!fs.existsSync(full)) return [];
  const content = fs.readFileSync(full, "utf8");
  const lines = content.split("\n").slice(-20000); // cap for performance
  const out: ParsedLine[] = [];
  for (const l of lines) {
    const m = LOG_LINE_RE.exec(l);
    if (!m) continue;
    const t = new Date(m[2].replace(":", " ").replace(/(\d+)\/(\w+)\/(\d+)/, "$1 $2 $3"));
    if (isNaN(t.getTime()) || t.getTime() < sinceMs) continue;
    const upstream = m[7] && m[7] !== "-" ? m[7].split(",")[0].trim() : null;
    const rt = Number(m[8]);
    out.push({
      time: t,
      status: Number(m[5]),
      bytes: Number(m[6]),
      upstream,
      requestTimeMs: isNaN(rt) ? null : Math.round(rt * 1000),
    });
  }
  return out;
}

function parseFiles(fileNames: string[], sinceMs: number, upstreamFilter?: string): ParsedLine[] {
  const entries = fileNames.flatMap((f) => tailParse(f, sinceMs));
  if (!upstreamFilter) return entries;
  return entries.filter((e) => e.upstream === upstreamFilter);
}

// ---------- workflow loading (for scope resolution) ----------

function loadAllWorkflows(): Workflow[] {
  const rows = db.prepare("SELECT * FROM workflows").all() as any[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    version: row.version,
    updatedAt: row.updated_at,
    domains: JSON.parse(row.domains),
    nodes: JSON.parse(row.nodes),
    edges: JSON.parse(row.edges),
  }));
}

/** Domain-level aggregate files: every domain file under this listener. */
function filesForListener(wf: Workflow, listenerId: string): string[] {
  return domainsForListener(wf, listenerId).map((d) => domainLogFile(wf.id, listenerId, d.id));
}

interface NodeFileTarget {
  files: string[];
  upstreamFilter?: string;
}

/**
 * Resolves which real log file(s) answer "how many requests hit node X",
 * and — for a Backend node sitting behind a Load Balancer — which
 * $upstream_addr value to filter on so its count doesn't include its
 * sibling backends' traffic.
 */
function findNodeFiles(nodeId: string): NodeFileTarget | null {
  for (const wf of loadAllWorkflows()) {
    const node = wf.nodes.find((n) => n.id === nodeId);
    if (!node) continue;

    if (node.type === "Listener") {
      return { files: filesForListener(wf, node.id) };
    }

    const scopes = computeNodeScopes(wf);
    const scope = scopes.get(nodeId);
    if (!scope) return { files: [] }; // node exists but isn't wired into a Listener->Domain chain yet

    if (node.type === "Domain") {
      return { files: [domainLogFile(wf.id, scope.listenerId, node.id)] };
    }

    // Route, Auth, RateLimit, Cache, LB, GRPC, Backend: all share their
    // branch's single location log file.
    const files = [locationLogFile(wf.id, scope.scopeKey)];

    let upstreamFilter: string | undefined;
    if (node.type === "Backend") {
      const siblingIds = [...scopes.entries()]
        .filter(([, s]) => s.scopeKey === scope.scopeKey)
        .map(([id]) => id);
      const hasLB = wf.nodes.some((n) => siblingIds.includes(n.id) && n.type === "LB");
      if (hasLB) upstreamFilter = `${node.properties.address}:${node.properties.port}`;
    }

    return { files, upstreamFilter };
  }
  return null;
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
  const allFiles = listAllAccessLogFiles().filter((f) => !workflowId || f.startsWith(`wf_${workflowId}__`));
  const entries = parseFiles(allFiles, since);

  const bucketCount = range === "1h" ? 12 : range === "24h" ? 24 : range === "7d" ? 7 : 30;
  const stepMs = windowMs[range] / bucketCount;

  const points: MetricPoint[] = [];
  for (let i = bucketCount - 1; i >= 0; i--) {
    const bucketStart = Date.now() - (i + 1) * stepMs;
    const bucketEnd = Date.now() - i * stepMs;
    const inBucket = entries.filter((e) => e.time.getTime() >= bucketStart && e.time.getTime() < bucketEnd);
    const errors = inBucket.filter((e) => e.status >= 500).length;
    const latencies = inBucket.map((e) => e.requestTimeMs).filter((v): v is number => v !== null);
    const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
    const label = new Date(bucketEnd);
    points.push({
      time: buckets[range] === "day" ? label.toISOString().slice(5, 10) : `${label.getHours().toString().padStart(2, "0")}:00`,
      requests: inBucket.length,
      errors,
      latencyMs: avgLatency,
    });
  }
  return points;
}

export function getStats() {
  const workflows = db.prepare("SELECT status, domains FROM workflows").all() as any[];
  const certs = db.prepare("SELECT status FROM certificates").all() as any[];
  const since = Date.now() - 60_000; // last minute for rps
  const files = listAllAccessLogFiles();
  const recent = parseFiles(files, since);
  const errorCount = recent.filter((e) => e.status >= 500).length;

  let totalDomains = 0;
  for (const w of workflows) totalDomains += (JSON.parse(w.domains || "[]") as string[]).length;

  return {
    totalWorkflows: workflows.length,
    deployed: workflows.filter((w) => w.status === "deployed").length,
    drifted: workflows.filter((w) => w.status === "drifted").length,
    failed: workflows.filter((w) => w.status === "failed").length,
    totalDomains,
    expiringCerts: certs.filter((c) => c.status === "expiring").length,
    requestsPerSec: Math.round((recent.length / 60) * 100) / 100,
    errorRate: recent.length ? Math.round((errorCount / recent.length) * 10000) / 100 : 0,
    p95Latency: percentile(
      recent.map((e) => e.requestTimeMs).filter((v): v is number => v !== null),
      95,
    ),
  };
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/**
 * Real per-node request counts. A Listener's count is the sum of all its
 * Domains; a Domain's count is every request that hit that server block
 * regardless of which location matched; a Route/LB/Auth/RateLimit/Cache's
 * count is scoped to just its own branch; a Backend behind a Load Balancer
 * is filtered down to just the requests nginx actually sent to it
 * (via $upstream_addr) — so e.g. LB=100, backend A=63, backend B=37 rather
 * than every node in the chain reporting the same total.
 */
export function getNodeStats(nodeId: string, range: string) {
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

  const target = findNodeFiles(nodeId);
  if (!target) {
    return { nodeId, range, count: 0, generatedAt: new Date().toISOString(), found: false };
  }
  const entries = parseFiles(target.files, since, target.upstreamFilter);
  return {
    nodeId,
    range,
    count: entries.length,
    generatedAt: new Date().toISOString(),
    found: true,
  };
}
