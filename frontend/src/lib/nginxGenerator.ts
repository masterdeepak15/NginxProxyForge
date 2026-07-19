import type { Workflow, WorkflowNode, NodeType } from "@/services/api";
import { domainsForListener, partitionDomain, domainLogFile, domainErrorLogFile, locationLogFile } from "./graphScope";

// Mirrors backend/src/lib/nginxGenerator.ts exactly so this live preview
// matches what actually gets deployed. Keep buildParts() and its helpers
// in sync between the two files.

interface HeaderEntry {
  name: string;
  value: string;
  always?: boolean;
}

const indent = (n: number) => "  ".repeat(n);
function line(depth: number, s: string) {
  return indent(depth) + s;
}
function get<T = unknown>(node: WorkflowNode, key: string, fallback?: T): T {
  const v = node.properties[key];
  return (v === undefined ? fallback : (v as T)) as T;
}
function outgoing(wf: Workflow, id: string): WorkflowNode[] {
  const ids = wf.edges.filter((e) => e.from === id).map((e) => e.to);
  return ids.map((i) => wf.nodes.find((n) => n.id === i)).filter((n): n is WorkflowNode => Boolean(n));
}
function firstOfType(nodes: WorkflowNode[], type: NodeType): WorkflowNode | undefined {
  return nodes.find((n) => n.type === type);
}
function headersBlock(depth: number, headers: HeaderEntry[]): string[] {
  if (!Array.isArray(headers)) return [];
  return headers
    .filter((h) => h && h.name && h.value)
    .map((h) => line(depth, `add_header ${h.name} "${h.value}"${h.always ? " always" : ""};`));
}
function extras(depth: number, node: WorkflowNode): string[] {
  const out: string[] = [];
  out.push(...headersBlock(depth, get<HeaderEntry[]>(node, "extraHeaders", [])));
  const extra = get<string>(node, "extraDirectives", "");
  if (extra && extra.trim()) for (const l of extra.split("\n")) out.push(line(depth, l));
  return out;
}
function locationPrefix(mode: string): string {
  switch (mode) {
    case "exact":
      return "= ";
    case "preferential":
      return "^~ ";
    case "regex":
      return "~ ";
    case "regex-ci":
      return "~* ";
    default:
      return "";
  }
}
function backendScheme(b: WorkflowNode): string {
  return get<string>(b, "scheme", "http") === "https" ? "https" : "http";
}

interface Parts {
  httpTop: string[];
  httpServers: string[];
  streamBlocks: string[];
}

function buildLocationContent(
  scopeNodes: WorkflowNode[],
  route: WorkflowNode | null,
  logFiles: { domain: string; location: string },
): { topLevel: string[]; lines: string[] } {
  const topLevel: string[] = [];
  const lines: string[] = [];

  const rateLimit = firstOfType(scopeNodes, "RateLimit");
  const cache = firstOfType(scopeNodes, "Cache");
  const lb = firstOfType(scopeNodes, "LB");
  const backends = scopeNodes.filter((n) => n.type === "Backend");
  const grpcs = scopeNodes.filter((n) => n.type === "GRPC");
  const auth = firstOfType(scopeNodes, "Auth");

  if (rateLimit) {
    topLevel.push(
      `limit_req_zone ${get(rateLimit, "key")} zone=${get(rateLimit, "zoneName")}:${get(rateLimit, "zoneSizeMb")}m rate=${get(rateLimit, "rate")};`,
    );
  }
  if (cache) {
    topLevel.push(
      `proxy_cache_path /var/cache/nginx/${get(cache, "zoneName")} levels=1:2 keys_zone=${get(cache, "zoneName")}:${get(cache, "zoneSizeMb")}m inactive=${get(cache, "inactive")};`,
    );
  }

  let proxyTarget = "";
  if (lb && backends.length) {
    const upName = get<string>(lb, "name", "upstream_pool");
    const scheme = backendScheme(backends[0]);
    const upstream: string[] = [`upstream ${upName} {`];
    const algo = get<string>(lb, "algorithm");
    if (algo === "least_conn") upstream.push(line(1, "least_conn;"));
    else if (algo === "ip_hash") upstream.push(line(1, "ip_hash;"));
    else if (algo === "hash") upstream.push(line(1, `hash ${get(lb, "hashKey")};`));
    for (const b of backends) {
      const parts = [`${get(b, "address")}:${get(b, "port")}`];
      if (get<number>(b, "weight", 1) !== 1) parts.push(`weight=${get(b, "weight")}`);
      parts.push(`max_fails=${get(b, "maxFails")}`);
      parts.push(`fail_timeout=${get(b, "failTimeout")}`);
      if (get<boolean>(b, "backup")) parts.push("backup");
      upstream.push(line(1, `server ${parts.join(" ")};`));
    }
    const ka = get<number>(lb, "keepalive", 0);
    if (ka > 0) upstream.push(line(1, `keepalive ${ka};`));
    upstream.push(...extras(1, lb));
    upstream.push("}");
    topLevel.push(upstream.join("\n"));
    proxyTarget = `${scheme}://${upName}`;
  } else if (backends.length) {
    const b = backends[0];
    proxyTarget = `${backendScheme(b)}://${get(b, "address")}:${get(b, "port")}`;
  }

  lines.push(line(2, `access_log /data/logs/${logFiles.domain} pf;`));
  lines.push(line(2, `access_log /data/logs/${logFiles.location} pf;`));

  if (auth) {
    const t = get<string>(auth, "type");
    if (t === "basic") {
      lines.push(line(2, `auth_basic "${get(auth, "realm")}";`));
      lines.push(line(2, `auth_basic_user_file ${get(auth, "userFile")};`));
    } else if (t === "ip-allowlist") {
      for (const cidr of get<string[]>(auth, "allowList", [])) lines.push(line(2, `allow ${cidr};`));
      lines.push(line(2, `deny all;`));
    } else if (t === "jwt") {
      lines.push(line(2, `auth_jwt "closed area";`));
      lines.push(line(2, `# auth_jwt_key_request /_jwks;   # points to ${get(auth, "jwksUri")}`));
    } else if (t === "subrequest") {
      lines.push(line(2, `auth_request ${get(auth, "subrequestUri")};`));
    }
    lines.push(...extras(2, auth));
  }

  if (rateLimit) {
    const parts = [`zone=${get(rateLimit, "zoneName")}`, `burst=${get(rateLimit, "burst")}`];
    if (get<boolean>(rateLimit, "nodelay")) parts.push("nodelay");
    lines.push(line(2, `limit_req ${parts.join(" ")};`));
  }

  if (cache) {
    lines.push(line(2, `proxy_cache ${get(cache, "zoneName")};`));
    lines.push(line(2, `proxy_cache_valid ${get(cache, "validCodes")};`));
    lines.push(line(2, `proxy_cache_key ${get(cache, "key")};`));
    const bypass = get<string>(cache, "bypass", "");
    if (bypass) lines.push(line(2, `proxy_cache_bypass ${bypass};`));
  }

  if (route) {
    const rewrite = get<string>(route, "rewrite", "");
    const tryFiles = get<string>(route, "tryFiles", "");
    if (rewrite) lines.push(line(2, `rewrite ${rewrite};`));
    if (tryFiles) lines.push(line(2, `try_files ${tryFiles};`));
    lines.push(...extras(2, route));
  }

  if (grpcs.length) {
    const g = grpcs[0];
    for (const h of get<HeaderEntry[]>(g, "grpcHeaders", [])) {
      if (h?.name && h?.value) lines.push(line(2, `grpc_set_header ${h.name} "${h.value}";`));
    }
    lines.push(line(2, `grpc_connect_timeout ${get(g, "connectTimeout")};`));
    lines.push(line(2, `grpc_read_timeout ${get(g, "readTimeout")};`));
    lines.push(line(2, `grpc_send_timeout ${get(g, "sendTimeout")};`));
    const scheme = get<boolean>(g, "tls") ? "grpcs" : "grpc";
    lines.push(line(2, `grpc_pass ${scheme}://${get(g, "address")}:${get(g, "port")};`));
    lines.push(...extras(2, g));
  } else if (backends.length) {
    const first = backends[0];
    for (const h of get<HeaderEntry[]>(first, "proxyHeaders", [])) {
      if (h?.name && h?.value) lines.push(line(2, `proxy_set_header ${h.name} "${h.value}";`));
    }
    lines.push(line(2, `proxy_connect_timeout ${get(first, "connectTimeout")};`));
    lines.push(line(2, `proxy_read_timeout ${get(first, "readTimeout")};`));
    if (proxyTarget) lines.push(line(2, `proxy_pass ${proxyTarget};`));
    lines.push(...extras(2, first));
  } else if (!route) {
    return { topLevel: [], lines: [] };
  }

  return { topLevel, lines };
}

function buildDomainServer(
  wf: Workflow,
  listener: WorkflowNode,
  domain: WorkflowNode,
): { serverBlock: string; topLevel: string[] } {
  const directChildren = outgoing(wf, domain.id);
  const ssl = directChildren.find((n) => n.type === "SSL");
  const { routes, routeSubtrees, rootNodes } = partitionDomain(wf, domain.id);

  const topLevel: string[] = [];
  const srv: string[] = ["server {"];

  const listenParts: string[] = [`${get(listener, "port")}`];
  if (get(listener, "protocol") === "https") listenParts.push("ssl");
  if (get<boolean>(listener, "http2")) listenParts.push("http2");
  if (get<boolean>(listener, "defaultServer")) listenParts.push("default_server");
  if (get<boolean>(listener, "proxyProtocol")) listenParts.push("proxy_protocol");
  if (get<boolean>(listener, "reuseport")) listenParts.push("reuseport");
  srv.push(line(1, `listen ${listenParts.join(" ")};`));

  const hosts = get<string[]>(domain, "hostnames", []);
  if (hosts.length) srv.push(line(1, `server_name ${hosts.join(" ")};`));

  srv.push(line(1, `error_log /data/logs/${domainErrorLogFile(wf.id, listener.id, domain.id)} warn;`));

  if (ssl && get(listener, "protocol") === "https") {
    const isLe = Boolean(get<boolean>(ssl, "leMode"));
    const leIssued = isLe && String(get<string>(ssl, "leStatus", "")) === "issued";
    let certRef = "";
    let keyRef = "";
    if (leIssued) {
      certRef = get<string>(ssl, "certPath", "") || "/data/certs/letsencrypt/config/live/<domain>/fullchain.pem";
      keyRef = get<string>(ssl, "keyPath", "") || "/data/certs/letsencrypt/config/live/<domain>/privkey.pem";
    } else if (isLe) {
      certRef = "/data/certs/letsencrypt/config/live/<pending>/fullchain.pem";
      keyRef = "/data/certs/letsencrypt/config/live/<pending>/privkey.pem";
    } else {
      srv.push(line(1, `# TLS material provided inline; backend writes it to a managed path.`));
      certRef = `/data/certs/managed/${ssl.id}/fullchain.pem`;
      keyRef = `/data/certs/managed/${ssl.id}/privkey.pem`;
    }
    srv.push(line(1, `ssl_certificate ${certRef};`));
    srv.push(line(1, `ssl_certificate_key ${keyRef};`));
    const protos = get<string[]>(ssl, "protocols", []);
    if (protos.length) srv.push(line(1, `ssl_protocols ${protos.join(" ")};`));
    const ciphers = get<string>(ssl, "ciphers", "");
    if (ciphers) srv.push(line(1, `ssl_ciphers ${ciphers};`));
    if (get<boolean>(ssl, "preferServerCiphers")) srv.push(line(1, `ssl_prefer_server_ciphers on;`));
    if (get<boolean>(ssl, "hsts"))
      srv.push(
        line(1, `add_header Strict-Transport-Security "max-age=${get(ssl, "hstsMaxAge")}; includeSubDomains" always;`),
      );
    srv.push(...extras(1, ssl));
  }

  srv.push(...extras(1, listener));
  srv.push(...extras(1, domain));

  const domainLog = domainLogFile(wf.id, listener.id, domain.id);

  const rootHasContent = rootNodes.some((n) => n.type === "Backend" || n.type === "GRPC");
  if (rootHasContent || routes.length === 0) {
    const built = buildLocationContent(rootNodes, null, {
      domain: domainLog,
      location: locationLogFile(wf.id, `root_${domain.id}`),
    });
    if (built.lines.length) {
      topLevel.push(...built.topLevel);
      srv.push(line(1, "location / {"));
      srv.push(...built.lines);
      srv.push(line(1, "}"));
    }
  }

  for (const rs of routeSubtrees) {
    const path = get<string>(rs.route, "path", "/");
    const prefix = locationPrefix(get<string>(rs.route, "matchMode", "prefix"));
    const built = buildLocationContent(rs.nodes, rs.route, {
      domain: domainLog,
      location: locationLogFile(wf.id, `route_${rs.route.id}`),
    });
    topLevel.push(...built.topLevel);
    srv.push(line(1, `location ${prefix}${path} {`));
    srv.push(...built.lines);
    srv.push(line(1, "}"));
  }

  srv.push("}");
  return { serverBlock: srv.join("\n"), topLevel };
}

function buildParts(workflow: Workflow): Parts {
  const httpListeners = workflow.nodes.filter((n) => n.type === "Listener");
  const tcpListeners = workflow.nodes.filter((n) => n.type === "TCP");
  const udpListeners = workflow.nodes.filter((n) => n.type === "UDP");

  const httpTop: string[] = [];
  const httpServers: string[] = [];
  const streamBlocks: string[] = [];

  for (const listener of httpListeners) {
    for (const domain of domainsForListener(workflow, listener.id)) {
      const { serverBlock, topLevel } = buildDomainServer(workflow, listener, domain);
      httpTop.push(...topLevel);
      httpServers.push(serverBlock);
    }
  }

  for (const l of [...tcpListeners, ...udpListeners]) {
    const seen = new Set<string>([l.id]);
    const queue = [l.id];
    const chain: WorkflowNode[] = [];
    const start = workflow.nodes.find((n) => n.id === l.id);
    if (start) chain.push(start);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of outgoing(workflow, cur)) {
        if (seen.has(next.id)) continue;
        seen.add(next.id);
        chain.push(next);
        queue.push(next.id);
      }
    }
    const backends = chain.filter((n) => n.type === "Backend");
    const s: string[] = [line(1, "server {")];
    const isUdp = l.type === "UDP";
    s.push(line(2, `listen ${get(l, "port")}${isUdp ? " udp" : ""};`));
    const target =
      backends.length > 0
        ? `${get(backends[0], "address")}:${get(backends[0], "port")}`
        : get<string>(l, "proxyPass");
    s.push(line(2, `proxy_pass ${target};`));
    s.push(line(2, `proxy_timeout ${get(l, "proxyTimeout")};`));
    if (!isUdp) s.push(line(2, `proxy_connect_timeout ${get(l, "proxyConnectTimeout")};`));
    if (isUdp) s.push(line(2, `proxy_responses ${get(l, "proxyResponses")};`));
    s.push(...extras(2, l));
    s.push(line(1, "}"));
    streamBlocks.push(s.join("\n"));
  }

  return { httpTop, httpServers, streamBlocks };
}

/** Full preview: wrapped in http{}/stream{}. */
export function generateNginxConfig(workflow: Workflow): string {
  const { httpTop, httpServers, streamBlocks } = buildParts(workflow);
  const out: string[] = [];
  out.push("# Generated by ProxyForge — preview only");
  out.push("# workflow: " + workflow.name + " (v" + workflow.version + ")");
  out.push("");
  if (httpServers.length) {
    out.push("http {");
    for (const t of httpTop) for (const l of t.split("\n")) out.push(line(1, l));
    if (httpTop.length) out.push("");
    for (const s of httpServers) {
      for (const l of s.split("\n")) out.push(line(1, l));
      out.push("");
    }
    out.push("}");
    out.push("");
  }
  if (streamBlocks.length) {
    out.push("stream {");
    for (const s of streamBlocks) {
      out.push(s);
      out.push("");
    }
    out.push("}");
  }
  return out.join("\n");
}
