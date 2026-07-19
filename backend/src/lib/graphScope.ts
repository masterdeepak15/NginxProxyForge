import type { Workflow, WorkflowNode } from "../types";

// Shared node-graph scope resolution, used by both the config generator
// (to name per-location log files) and metrics.ts (to know which log
// file(s) answer "how many requests hit node X"). Keeping this in one
// place guarantees the generator and the metrics reader agree on filenames.

export interface NodeScope {
  listenerId: string;
  domainId: string;
  routeId: string | null; // null = the domain's root/default location
  scopeKey: string; // "route_<id>" or "root_<domainId>" — see locationLogFile()
}

function outgoing(wf: Workflow, id: string): WorkflowNode[] {
  const ids = wf.edges.filter((e) => e.from === id).map((e) => e.to);
  return ids
    .map((i) => wf.nodes.find((n) => n.id === i))
    .filter((n): n is WorkflowNode => Boolean(n));
}

export function reachable(wf: Workflow, startId: string): WorkflowNode[] {
  const seen = new Set<string>([startId]);
  const queue = [startId];
  const out: WorkflowNode[] = [];
  const start = wf.nodes.find((n) => n.id === startId);
  if (start) out.push(start);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of outgoing(wf, cur)) {
      if (seen.has(next.id)) continue;
      seen.add(next.id);
      out.push(next);
      queue.push(next.id);
    }
  }
  return out;
}

/** Every Domain node directly bound to this Listener. */
export function domainsForListener(wf: Workflow, listenerId: string): WorkflowNode[] {
  return outgoing(wf, listenerId).filter((n) => n.type === "Domain");
}

/**
 * For one Domain: its direct Route children, plus the set of "root" nodes
 * (middleware/backends attached directly to the domain, outside any Route's
 * own subtree) that make up the domain's default "/" location. A Route's
 * subtree is everything reachable starting at the Route node itself.
 */
export function partitionDomain(wf: Workflow, domainId: string) {
  const directChildren = outgoing(wf, domainId);
  const routes = directChildren.filter((n) => n.type === "Route");

  const routeSubtrees = routes.map((route) => ({ route, nodes: reachable(wf, route.id) }));
  const routeScopedIds = new Set<string>();
  for (const rs of routeSubtrees) for (const n of rs.nodes) routeScopedIds.add(n.id);

  const fullChain = reachable(wf, domainId);
  const rootNodes = fullChain.filter(
    (n) => n.id !== domainId && n.type !== "SSL" && n.type !== "Route" && !routeScopedIds.has(n.id),
  );

  return { routes, routeSubtrees, rootNodes };
}

/** Build a full node-id -> scope map for a workflow's HTTP side. */
export function computeNodeScopes(wf: Workflow): Map<string, NodeScope> {
  const map = new Map<string, NodeScope>();
  const listeners = wf.nodes.filter((n) => n.type === "Listener");
  for (const listener of listeners) {
    for (const domain of domainsForListener(wf, listener.id)) {
      const { routeSubtrees, rootNodes } = partitionDomain(wf, domain.id);
      const rootScope: NodeScope = {
        listenerId: listener.id,
        domainId: domain.id,
        routeId: null,
        scopeKey: `root_${domain.id}`,
      };
      map.set(domain.id, rootScope);
      for (const n of rootNodes) map.set(n.id, rootScope);
      for (const rs of routeSubtrees) {
        const scope: NodeScope = {
          listenerId: listener.id,
          domainId: domain.id,
          routeId: rs.route.id,
          scopeKey: `route_${rs.route.id}`,
        };
        for (const n of rs.nodes) map.set(n.id, scope);
      }
    }
  }
  return map;
}

// ---- log filename conventions, shared by generator + metrics ----

export function domainLogFile(workflowId: string, listenerId: string, domainId: string): string {
  return `wf_${workflowId}__listener_${listenerId}__domain_${domainId}.access.log`;
}

export function locationLogFile(workflowId: string, scopeKey: string): string {
  return `wf_${workflowId}__loc_${scopeKey}.access.log`;
}

export function domainErrorLogFile(workflowId: string, listenerId: string, domainId: string): string {
  return `wf_${workflowId}__listener_${listenerId}__domain_${domainId}.error.log`;
}
