/**
 * ProxyForge API Service (dummy in-memory implementation).
 * Replace with real HTTP calls when the backend is available.
 */

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "operator" | "viewer";
  avatar?: string;
}

export type NodeType =
  | "Listener"
  | "Domain"
  | "SSL"
  | "Route"
  | "Auth"
  | "RateLimit"
  | "Cache"
  | "LB"
  | "Backend"
  | "GRPC"
  | "TCP"
  | "UDP";

export interface WorkflowNode {
  id: string;
  type: NodeType;
  label: string;
  x: number;
  y: number;
  properties: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  status: "deployed" | "drifted" | "failed" | "draft";
  version: number;
  updatedAt: string;
  domains: string[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface Deployment {
  id: string;
  workflowId: string;
  workflowName: string;
  version: number;
  status: "success" | "failed" | "rolled_back" | "in_progress";
  author: string;
  timestamp: string;
  durationMs: number;
}

export interface Certificate {
  id: string;
  domain: string;
  issuer: string;
  expiresAt: string;
  status: "valid" | "expiring" | "expired";
}

export interface MetricPoint {
  time: string;
  requests: number;
  errors: number;
  latencyMs: number;
}

const delay = (ms = 400) => new Promise((r) => setTimeout(r, ms));

// ---------- Seed data ----------

const users: (User & { password: string })[] = [
  {
    id: "u_1",
    email: "admin@proxyforge.io",
    password: "admin123",
    name: "Alex Morgan",
    role: "admin",
  },
  {
    id: "u_2",
    email: "ops@proxyforge.io",
    password: "ops123",
    name: "Jamie Rivera",
    role: "operator",
  },
];

const workflows: Workflow[] = [
  {
    id: "wf_edge_api",
    name: "Public API Edge",
    description: "Main HTTPS edge for api.example.com and www.example.com with per-host TLS, rate limits, and JWT auth.",
    status: "deployed",
    version: 7,
    updatedAt: "2026-07-10T14:22:00Z",
    domains: ["api.example.com", "www.example.com"],
    nodes: [
      { id: "n1", type: "Listener", label: "HTTPS :443", x: 60, y: 80, properties: { port: 443, protocol: "https" } },
      { id: "n2", type: "Domain", label: "api.example.com", x: 300, y: 80, properties: { hostnames: ["api.example.com", "www.example.com"] } },
      { id: "n3", type: "SSL", label: "LE · api.example.com", x: 60, y: 260, properties: { leMode: true, leDomain: "api.example.com", leChallenge: "http-01", leEmail: "ops@proxyforge.io", leStatus: "issued" } },
      { id: "n3b", type: "SSL", label: "LE · www.example.com", x: 320, y: 320, properties: { leMode: true, leDomain: "www.example.com", leChallenge: "dns-01", leDnsProvider: "cloudflare", leEmail: "ops@proxyforge.io", leStatus: "issued" } },
      { id: "n4", type: "RateLimit", label: "50 rps / burst 100", x: 560, y: 80, properties: { rate: "50r/s", burst: 100 } },
      { id: "n5", type: "Route", label: "/v1/*", x: 780, y: 80, properties: { path: "/v1/*", matchMode: "prefix" } },
      { id: "n6", type: "Backend", label: "api-service:8080", x: 1000, y: 80, properties: { address: "api-service", port: 8080 } },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2" },
      { id: "e2", from: "n2", to: "n3" },
      { id: "e2b", from: "n2", to: "n3b" },
      { id: "e3", from: "n2", to: "n4" },
      { id: "e4", from: "n4", to: "n5" },
      { id: "e5", from: "n5", to: "n6" },
    ],
  },
  {
    id: "wf_marketing",
    name: "Marketing Site",
    description: "Static marketing site with cache + CDN origin.",
    status: "deployed",
    version: 3,
    updatedAt: "2026-07-09T09:12:00Z",
    domains: ["www.example.com", "example.com"],
    nodes: [
      { id: "n1", type: "Listener", label: "HTTPS :443", x: 60, y: 80, properties: { port: 443 } },
      { id: "n2", type: "Domain", label: "www.example.com", x: 260, y: 80, properties: { hostname: "www.example.com" } },
      { id: "n3", type: "Cache", label: "TTL 5m", x: 460, y: 80, properties: { ttl: 300 } },
      { id: "n4", type: "Backend", label: "static-origin", x: 660, y: 80, properties: { upstream: "cdn.origin:80" } },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2" },
      { id: "e2", from: "n2", to: "n3" },
      { id: "e3", from: "n3", to: "n4" },
    ],
  },
  {
    id: "wf_admin",
    name: "Internal Admin",
    description: "IP-allowlisted admin console.",
    status: "drifted",
    version: 12,
    updatedAt: "2026-07-08T18:44:00Z",
    domains: ["admin.internal.example.com"],
    nodes: [
      { id: "n1", type: "Listener", label: "HTTPS :443", x: 60, y: 80, properties: {} },
      { id: "n2", type: "Domain", label: "admin.internal", x: 260, y: 80, properties: {} },
      { id: "n3", type: "Auth", label: "IP Allowlist", x: 460, y: 80, properties: {} },
      { id: "n4", type: "Backend", label: "admin:9000", x: 660, y: 80, properties: {} },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2" },
      { id: "e2", from: "n2", to: "n3" },
      { id: "e3", from: "n3", to: "n4" },
    ],
  },
  {
    id: "wf_db_proxy",
    name: "Postgres TCP Proxy",
    description: "L4 stream proxy for Postgres.",
    status: "failed",
    version: 2,
    updatedAt: "2026-07-07T11:03:00Z",
    domains: ["db.internal.example.com"],
    nodes: [
      { id: "n1", type: "TCP", label: "TCP :5432", x: 60, y: 80, properties: { port: 5432 } },
      { id: "n2", type: "Backend", label: "pg-primary:5432", x: 260, y: 80, properties: {} },
    ],
    edges: [{ id: "e1", from: "n1", to: "n2" }],
  },
  {
    id: "wf_websocket",
    name: "Realtime Websocket",
    description: "WSS edge for realtime events.",
    status: "draft",
    version: 1,
    updatedAt: "2026-07-06T15:30:00Z",
    domains: ["ws.example.com"],
    nodes: [
      { id: "n1", type: "Listener", label: "HTTPS :443", x: 60, y: 80, properties: {} },
      { id: "n2", type: "Domain", label: "ws.example.com", x: 260, y: 80, properties: { hostnames: ["ws.example.com"] } },
      { id: "n3", type: "Route", label: "/socket", x: 460, y: 80, properties: { path: "/socket" } },
      { id: "n4", type: "Backend", label: "realtime:6001", x: 660, y: 80, properties: { address: "realtime", port: 6001 } },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2" },
      { id: "e2", from: "n2", to: "n3" },
      { id: "e3", from: "n3", to: "n4" },
    ],
  },
  {
    id: "wf_grpc",
    name: "gRPC Payments API",
    description: "HTTPS/2 gRPC edge fronting payment microservice.",
    status: "deployed",
    version: 4,
    updatedAt: "2026-07-11T10:15:00Z",
    domains: ["grpc.example.com"],
    nodes: [
      { id: "n1", type: "Listener", label: "HTTPS :443", x: 60, y: 80, properties: { port: 443, protocol: "https", http2: true } },
      { id: "n2", type: "Domain", label: "grpc.example.com", x: 260, y: 80, properties: { hostnames: ["grpc.example.com"] } },
      { id: "n3", type: "SSL", label: "Let's Encrypt", x: 260, y: 260, properties: { leMode: true, leDomain: "grpc.example.com" } },
      { id: "n4", type: "Auth", label: "JWT", x: 460, y: 80, properties: { type: "jwt" } },
      { id: "n5", type: "GRPC", label: "grpcs://payments:50051", x: 680, y: 80, properties: { address: "payments", port: 50051, tls: true } },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2" },
      { id: "e2", from: "n2", to: "n3" },
      { id: "e3", from: "n2", to: "n4" },
      { id: "e4", from: "n4", to: "n5" },
    ],
  },
  {
    id: "wf_dns_udp",
    name: "DNS UDP Proxy",
    description: "L4 UDP stream proxy fronting an internal DNS resolver pool.",
    status: "deployed",
    version: 1,
    updatedAt: "2026-07-11T12:00:00Z",
    domains: ["dns.internal.example.com"],
    nodes: [
      { id: "n1", type: "UDP", label: "UDP :53", x: 60, y: 80, properties: { port: 53, proxyResponses: 1 } },
      { id: "n2", type: "Backend", label: "resolver:53", x: 320, y: 80, properties: { address: "resolver", port: 53 } },
    ],
    edges: [{ id: "e1", from: "n1", to: "n2" }],
  },
];


const deployments: Deployment[] = [
  { id: "d_1", workflowId: "wf_edge_api", workflowName: "Public API Edge", version: 7, status: "success", author: "Alex Morgan", timestamp: "2026-07-10T14:22:00Z", durationMs: 3200 },
  { id: "d_2", workflowId: "wf_marketing", workflowName: "Marketing Site", version: 3, status: "success", author: "Jamie Rivera", timestamp: "2026-07-09T09:12:00Z", durationMs: 2400 },
  { id: "d_3", workflowId: "wf_admin", workflowName: "Internal Admin", version: 12, status: "success", author: "Alex Morgan", timestamp: "2026-07-08T18:44:00Z", durationMs: 4100 },
  { id: "d_4", workflowId: "wf_db_proxy", workflowName: "Postgres TCP Proxy", version: 2, status: "failed", author: "Jamie Rivera", timestamp: "2026-07-07T11:03:00Z", durationMs: 1800 },
  { id: "d_5", workflowId: "wf_edge_api", workflowName: "Public API Edge", version: 6, status: "rolled_back", author: "Alex Morgan", timestamp: "2026-07-05T10:00:00Z", durationMs: 5100 },
  { id: "d_6", workflowId: "wf_marketing", workflowName: "Marketing Site", version: 2, status: "success", author: "Alex Morgan", timestamp: "2026-07-03T08:45:00Z", durationMs: 2100 },
];

const certificates: Certificate[] = [
  { id: "c_1", domain: "api.example.com", issuer: "Let's Encrypt", expiresAt: "2026-09-04T00:00:00Z", status: "valid" },
  { id: "c_2", domain: "www.example.com", issuer: "Let's Encrypt", expiresAt: "2026-07-25T00:00:00Z", status: "expiring" },
  { id: "c_3", domain: "admin.internal.example.com", issuer: "Internal CA", expiresAt: "2027-01-12T00:00:00Z", status: "valid" },
  { id: "c_4", domain: "ws.example.com", issuer: "Let's Encrypt", expiresAt: "2026-08-14T00:00:00Z", status: "valid" },
];

const buildMetrics = (): MetricPoint[] => {
  const out: MetricPoint[] = [];
  const now = Date.now();
  for (let i = 23; i >= 0; i--) {
    const t = new Date(now - i * 60 * 60 * 1000);
    out.push({
      time: `${t.getHours().toString().padStart(2, "0")}:00`,
      requests: 4000 + Math.round(Math.sin(i / 3) * 1200 + Math.random() * 800),
      errors: Math.round(20 + Math.random() * 40),
      latencyMs: 40 + Math.round(Math.sin(i / 2) * 15 + Math.random() * 10),
    });
  }
  return out;
};

// ---------- API surface ----------

export const apiService = {
  async login(email: string, password: string): Promise<{ user: User; token: string }> {
    await delay(600);
    const found = users.find((u) => u.email === email && u.password === password);
    if (!found) throw new Error("Invalid email or password");
    const { password: _p, ...user } = found;
    return { user, token: `demo.${found.id}.${Date.now()}` };
  },

  async listWorkflows(): Promise<Workflow[]> {
    await delay();
    return JSON.parse(JSON.stringify(workflows));
  },

  async getWorkflow(id: string): Promise<Workflow> {
    await delay();
    const wf = workflows.find((w) => w.id === id);
    if (!wf) throw new Error("Workflow not found");
    return JSON.parse(JSON.stringify(wf));
  },

  async listDeployments(): Promise<Deployment[]> {
    await delay();
    return JSON.parse(JSON.stringify(deployments));
  },

  async listCertificates(): Promise<Certificate[]> {
    await delay();
    return JSON.parse(JSON.stringify(certificates));
  },

  async getMetrics(): Promise<MetricPoint[]> {
    await delay(300);
    return buildMetrics();
  },

  async getStats() {
    await delay(200);
    return {
      totalWorkflows: workflows.length,
      deployed: workflows.filter((w) => w.status === "deployed").length,
      drifted: workflows.filter((w) => w.status === "drifted").length,
      failed: workflows.filter((w) => w.status === "failed").length,
      totalDomains: workflows.reduce((n, w) => n + w.domains.length, 0),
      expiringCerts: certificates.filter((c) => c.status === "expiring").length,
      requestsPerSec: 4820,
      errorRate: 0.42,
      p95Latency: 68,
    };
  },
};
