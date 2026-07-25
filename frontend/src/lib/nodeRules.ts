import type { NodeType, WorkflowNode, Workflow } from "@/services/api";

// Allowed connections: source type -> set of target types
export const allowedTargets: Record<NodeType, NodeType[]> = {
  Listener: ["Domain", "DefaultSite"],
  Domain: ["SSL", "Route", "Auth", "RateLimit", "Cache", "LB", "Backend", "GRPC"],
  SSL: [], // SSL is only a target of Domain
  Route: ["Auth", "RateLimit", "Cache", "LB", "Backend", "GRPC"],
  Auth: ["Route", "LB", "Backend", "GRPC"],
  RateLimit: ["Route", "LB", "Backend", "GRPC"],
  Cache: ["Route", "LB", "Backend", "GRPC"],
  LB: ["Backend", "GRPC"],
  Backend: [],
  GRPC: [],
  TCP: ["Backend"],
  UDP: ["Backend"],
  DefaultSite: [],
};

export function canConnect(fromType: NodeType, toType: NodeType): boolean {
  return allowedTargets[fromType]?.includes(toType) ?? false;
}

// A displayed host:port (or scheme://host:port) only needs an explicit
// port when it isn't the scheme's conventional default — mirrors the same
// rule used by nginxGenerator.ts when building proxy_pass/grpc_pass.
function isDefaultPort(https: boolean, port: unknown): boolean {
  const p = Number(port);
  return https ? p === 443 : p === 80;
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
    case "Backend": {
      const https = p.scheme === "https";
      const host = String(p.address ?? "backend");
      return isDefaultPort(https, p.port) ? host : `${host}:${p.port ?? ""}`;
    }
    case "GRPC": {
      const https = Boolean(p.tls);
      const scheme = https ? "grpcs" : "grpc";
      const host = String(p.address ?? "");
      return isDefaultPort(https, p.port) ? `${scheme}://${host}` : `${scheme}://${host}:${p.port ?? ""}`;
    }
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
    case "DefaultSite":
      return `Default: ${p.mode ?? "congratulations"}`;
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
