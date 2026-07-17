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

export type WorkflowStatus = "deployed" | "drifted" | "failed" | "draft";

export interface Workflow {
  id: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  version: number;
  updatedAt: string;
  domains: string[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export type DeploymentStatus = "success" | "failed" | "rolled_back" | "in_progress";

export interface Deployment {
  id: string;
  workflowId: string;
  workflowName: string;
  version: number;
  status: DeploymentStatus;
  author: string;
  timestamp: string;
  durationMs: number;
  logs?: string[];
}

export type CertStatus = "valid" | "expiring" | "expired";

export interface Certificate {
  id: string;
  domain: string;
  issuer: string;
  expiresAt: string;
  status: CertStatus;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "operator" | "viewer";
  avatar?: string;
}

export type StatsRange = "sec" | "min" | "hour" | "day" | "week" | "month";
