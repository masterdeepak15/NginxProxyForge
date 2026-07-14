import type { NodeType, WorkflowNode, Workflow } from "@/services/api";

// Allowed connections: source type -> set of target types
export const allowedTargets: Record<NodeType, NodeType[]> = {
  Listener: ["Domain"],
  Domain: ["SSL", "Route", "Auth", "RateLimit", "Cache", "LB", "Backend"],
  SSL: [], // SSL is only a target of Domain
  Route: ["Auth", "RateLimit", "Cache", "LB", "Backend"],
  Auth: ["Route", "LB", "Backend"],
  RateLimit: ["Route", "LB", "Backend"],
  Cache: ["Route", "LB", "Backend"],
  LB: ["Backend"],
  Backend: [],
  TCP: ["Backend"],
  UDP: ["Backend"],
};

export function canConnect(fromType: NodeType, toType: NodeType): boolean {
  return allowedTargets[fromType]?.includes(toType) ?? false;
}

// Derive a human label from node properties.
export function computeLabel(node: WorkflowNode): string {
  const p = node.properties;
  switch (node.type) {
    case "Listener": {
      const proto = String(p.protocol ?? "http").toUpperCase();
      return `${proto}:${p.port ?? ""}`;
    }
    case "Domain": {
      const hosts = (p.hostnames as string[]) ?? [];
      if (!hosts.length) return "Domain";
      return hosts.length === 1 ? hosts[0] : `${hosts[0]} +${hosts.length - 1}`;
    }
    case "SSL": {
      const mode = p.leMode ? "Let's Encrypt" : "Manual TLS";
      return mode;
    }
    case "Route":
      return String(p.path ?? "/");
    case "LB":
      return String(p.algorithm ?? "round-robin");
    case "Backend":
      return `${p.address ?? "backend"}:${p.port ?? ""}`;
    case "Auth":
      return `Auth · ${p.type ?? "none"}`;
    case "RateLimit":
      return `${p.rate ?? ""} burst ${p.burst ?? ""}`;
    case "Cache":
      return `Cache ${p.zoneName ?? ""}`;
    case "TCP":
      return `TCP :${p.port ?? ""}`;
    case "UDP":
      return `UDP :${p.port ?? ""}`;
    default:
      return node.type;
  }
}

// Does this Domain node sit behind an HTTPS listener?
export function domainIsHttps(wf: Workflow, domainId: string): boolean {
  const parents = wf.edges.filter((e) => e.to === domainId).map((e) => e.from);
  return parents.some((id) => {
    const n = wf.nodes.find((x) => x.id === id);
    return n?.type === "Listener" && n.properties.protocol === "https";
  });
}
