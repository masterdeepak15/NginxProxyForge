/**
 * ProxyForge API Service — real HTTP client for the ProxyForge backend.
 * Implements the contract in API.md. All requests go through `request()`,
 * which attaches the bearer token from localStorage and normalizes errors.
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
  logs?: string[];
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

export type StatsRange = "sec" | "min" | "hour" | "day" | "week" | "month";
export interface NodeStats {
  nodeId: string;
  range: StatsRange;
  count: number;
  generatedAt: string;
  series?: Array<{ time: string; count: number }>;
}

// ---------- HTTP client ----------

const API_BASE_URL =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_API_BASE_URL) || "/api";

function authHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const persisted = window.localStorage.getItem("pf_auth");
    const token = persisted ? JSON.parse(persisted)?.token : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function request<T>(
  path: string,
  init?: RequestInit & { query?: Record<string, string | number | undefined> },
): Promise<T> {
  let url = `${API_BASE_URL}${path}`;
  if (init?.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== "") params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
      ...(init?.headers || {}),
    },
  });

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const message = body?.error?.message || res.statusText || "Request failed";
    if (res.status === 401 && typeof window !== "undefined") {
      const hadSession = !!window.localStorage.getItem("pf_auth");
      window.localStorage.removeItem("pf_auth");
      // Notify the app shell so it can clear redux auth state and redirect
      // to /login. Only fire if we actually had a session — avoids bouncing
      // an already-logged-out user (e.g. the login page's own 401s).
      if (hadSession) {
        window.dispatchEvent(new CustomEvent("pf:auth-expired"));
      }
    }
    throw new Error(message);
  }

  return body as T;
}

const get = <T>(path: string, query?: Record<string, string | number | undefined>) =>
  request<T>(path, { method: "GET", query });
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined });
const patch = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "PATCH",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const del = <T>(path: string) => request<T>(path, { method: "DELETE" });

// ---------- API surface ----------

export const apiService = {
  // Auth
  async login(
    email: string,
    password: string,
  ): Promise<{ user: User; token: string; mustChangePassword: boolean }> {
    return post("/auth/login", { email, password });
  },
  async logout(): Promise<{ ok: true }> {
    return post("/auth/logout");
  },
  async me(): Promise<User> {
    return get("/auth/me");
  },
  async updateProfile(body: { name?: string; email?: string }): Promise<User> {
    return patch("/auth/me", body);
  },
  async changePassword(newPassword: string): Promise<{ ok: true }> {
    return post("/auth/change-password", { newPassword });
  },

  // Workflows
  async listWorkflows(): Promise<Workflow[]> {
    return get("/workflows");
  },
  async getWorkflow(id: string): Promise<Workflow> {
    return get(`/workflows/${id}`);
  },
  async createWorkflow(name: string, description?: string): Promise<Workflow> {
    return post("/workflows", { name, description });
  },
  async importWorkflow(
    name: string,
    config: string,
    description?: string,
  ): Promise<{ workflow: Workflow; warnings: string[] }> {
    return post("/workflows/import", { name, description, config });
  },
  async saveWorkflow(
    id: string,
    patchBody: Partial<Workflow> & { message?: string },
  ): Promise<Workflow> {
    return patch(`/workflows/${id}`, patchBody);
  },
  async deleteWorkflow(id: string): Promise<void> {
    return del(`/workflows/${id}`);
  },
  async validateWorkflow(
    id: string,
  ): Promise<{ ok: boolean; errors: Array<{ nodeId: string; field?: string; message: string }> }> {
    return post(`/workflows/${id}/validate`);
  },
  async compileWorkflow(id: string): Promise<{ config: string }> {
    return post(`/workflows/${id}/compile`);
  },
  async getWorkflowVersions(
    id: string,
  ): Promise<Array<{ version: number; updatedAt: string; author: string; message?: string }>> {
    return get(`/workflows/${id}/versions`);
  },
  async rollbackWorkflow(id: string, toVersion: number): Promise<Workflow> {
    return post(`/workflows/${id}/rollback`, { toVersion });
  },
  async deployWorkflow(id: string, message?: string): Promise<Deployment> {
    return post(`/workflows/${id}/deploy`, { message });
  },

  // Deployments
  async listDeployments(filters?: {
    workflowId?: string;
    status?: string;
    limit?: number;
  }): Promise<Deployment[]> {
    return get("/deployments", filters as Record<string, string | number | undefined>);
  },
  async getDeployment(id: string): Promise<Deployment> {
    return get(`/deployments/${id}`);
  },
  async rollbackDeployment(id: string): Promise<Deployment> {
    return post(`/deployments/${id}/rollback`);
  },

  // Certificates
  async listCertificates(): Promise<Certificate[]> {
    return get("/certificates");
  },
  async requestLetsEncrypt(params: {
    domain: string;
    challenge: "http-01" | "dns-01";
    dnsProvider?: string;
    email: string;
  }): Promise<{ jobId: string }> {
    return post("/certificates/lets-encrypt", params);
  },
  async getLetsEncryptJob(jobId: string): Promise<{
    status: "pending" | "issued" | "error";
    error?: string;
    certificateId?: string;
    certPath?: string;
    keyPath?: string;
    expiresAt?: string;
  }> {
    return get(`/certificates/lets-encrypt/${jobId}`);
  },
  async uploadCertificate(params: {
    domain: string;
    certPem: string;
    keyPem: string;
  }): Promise<Certificate> {
    return post("/certificates", params);
  },
  async deleteCertificate(id: string): Promise<void> {
    return del(`/certificates/${id}`);
  },

  // Metrics
  async getMetrics(
    range: "1h" | "24h" | "7d" | "30d" = "24h",
    workflowId?: string,
  ): Promise<MetricPoint[]> {
    return get("/metrics/traffic", { range, workflowId });
  },
  async getStats() {
    return get<{
      totalWorkflows: number;
      deployed: number;
      drifted: number;
      failed: number;
      totalDomains: number;
      expiringCerts: number;
      requestsPerSec: number;
      errorRate: number;
      p95Latency: number;
    }>("/metrics/stats");
  },
  async getDomainStats(
    range: "1h" | "24h" | "7d" | "30d" = "24h",
    limit = 10,
  ): Promise<{
    topByRequests: {
      domain: string;
      workflowId: string;
      workflowName: string;
      requests: number;
      errors: number;
    }[];
    topByErrors: {
      domain: string;
      workflowId: string;
      workflowName: string;
      requests: number;
      errors: number;
    }[];
  }> {
    return get("/metrics/domains", { range, limit });
  },
  async getRecentErrors(
    range: "1h" | "24h" | "7d" | "30d" = "24h",
    limit = 50,
  ): Promise<
    {
      time: string;
      level: string;
      type: string;
      domain: string;
      workflowId: string;
      workflowName: string;
      client: string | null;
      request: string | null;
      upstream: string | null;
    }[]
  > {
    return get("/metrics/errors", { range, limit });
  },
  async getNodeStats(nodeId: string, range: StatsRange): Promise<NodeStats> {
    return get(`/metrics/nodes/${nodeId}`, { range });
  },

  // Logs
  async getLogs(filters?: {
    workflowId?: string;
    level?: string;
    limit?: number;
    from?: string;
    to?: string;
  }): Promise<
    Array<{ ts: string; level: "info" | "warn" | "error"; workflowId?: string; message: string }>
  > {
    return get("/logs", filters as Record<string, string | number | undefined>);
  },
  /**
   * Server-side paginated log query, used by the Logs page. Passing
   * `page`/`pageSize` switches the backend into paginated mode, which
   * returns `{ data, total, page, pageSize }` instead of a bare array.
   */
  async getLogsPage(params: {
    page: number;
    pageSize: number;
    q?: string;
    workflowId?: string;
    level?: string;
  }): Promise<{
    data: Array<{
      ts: string;
      level: "info" | "warn" | "error";
      workflowId?: string;
      message: string;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    return get("/logs", params as Record<string, string | number | undefined>);
  },

  // Settings
  async getSettings(): Promise<Record<string, unknown>> {
    return get("/settings");
  },
  async updateSettings(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return patch("/settings", body);
  },
};
