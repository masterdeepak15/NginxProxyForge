import type { Workflow, WorkflowNode } from "@/services/api";

// Mirrors backend/src/lib/graphScope.ts — keep in sync. Used by the live
// nginx.conf preview so it matches exactly what gets deployed, including
// per-branch isolation (a Domain's Route branches and its root "/" branch
// never share backends) and per-location log file naming.

export interface NodeScope {
  listenerId: string;
  domainId: string;
  routeId: string | null;
  scopeKey: string;
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

export function domainsForListener(wf: Workflow, listenerId: string): WorkflowNode[] {
  return outgoing(wf, listenerId).filter((n) => n.type === "Domain");
}

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

export function domainLogFile(workflowId: string, listenerId: string, domainId: string): string {
  return `wf_${workflowId}__listener_${listenerId}__domain_${domainId}.access.log`;
}

export function locationLogFile(workflowId: string, scopeKey: string): string {
  return `wf_${workflowId}__loc_${scopeKey}.access.log`;
}

export function domainErrorLogFile(workflowId: string, listenerId: string, domainId: string): string {
  return `wf_${workflowId}__listener_${listenerId}__domain_${domainId}.error.log`;
}
