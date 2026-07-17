import type { NodeType, WorkflowNode, Workflow } from "../types";

// Allowed connections: source type -> set of target types
// Mirrors frontend src/lib/nodeRules.ts — keep in sync.
export const allowedTargets: Record<NodeType, NodeType[]> = {
  Listener: ["Domain"],
  Domain: ["SSL", "Route", "Auth", "RateLimit", "Cache", "LB", "Backend", "GRPC"],
  SSL: [],
  Route: ["Auth", "RateLimit", "Cache", "LB", "Backend", "GRPC"],
  Auth: ["Route", "LB", "Backend", "GRPC"],
  RateLimit: ["Route", "LB", "Backend", "GRPC"],
  Cache: ["Route", "LB", "Backend", "GRPC"],
  LB: ["Backend", "GRPC"],
  Backend: [],
  GRPC: [],
  TCP: ["Backend"],
  UDP: ["Backend"],
};

export function canConnect(fromType: NodeType, toType: NodeType): boolean {
  return allowedTargets[fromType]?.includes(toType) ?? false;
}

export function validateTopology(wf: Workflow): Array<{ nodeId: string; message: string }> {
  const errors: Array<{ nodeId: string; message: string }> = [];
  const nodeById = new Map(wf.nodes.map((n) => [n.id, n]));

  for (const e of wf.edges) {
    const from = nodeById.get(e.from);
    const to = nodeById.get(e.to);
    if (!from || !to) {
      errors.push({ nodeId: e.from, message: `Dangling edge ${e.id}` });
      continue;
    }
    if (!canConnect(from.type, to.type)) {
      errors.push({
        nodeId: from.id,
        message: `${from.type} cannot connect to ${to.type}`,
      });
    }
  }

  // Orphan check: every non-Listener/TCP/UDP node should have at least one inbound edge.
  const hasInbound = new Set(wf.edges.map((e) => e.to));
  for (const n of wf.nodes) {
    if (["Listener", "TCP", "UDP"].includes(n.type)) continue;
    if (!hasInbound.has(n.id)) {
      errors.push({ nodeId: n.id, message: `${n.type} node is not connected to anything upstream` });
    }
  }

  return errors;
}
