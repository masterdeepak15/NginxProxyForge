import type { Workflow, WorkflowNode, NodeType } from "@/services/api";
import type { HeaderEntry } from "./nodeSchemas";

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
  return ids
    .map((i) => wf.nodes.find((n) => n.id === i))
    .filter((n): n is WorkflowNode => Boolean(n));
}

function reachable(wf: Workflow, startId: string): WorkflowNode[] {
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
  if (extra && extra.trim()) {
    for (const l of extra.split("\n")) out.push(line(depth, l));
  }
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

export function generateNginxConfig(workflow: Workflow): string {
  const nodes = workflow.nodes;
  const httpListeners = nodes.filter((n) => n.type === "Listener");
  const tcpListeners = nodes.filter((n) => n.type === "TCP");
  const udpListeners = nodes.filter((n) => n.type === "UDP");

  const httpTop: string[] = [];
  const httpServers: string[] = [];
  const streamBlocks: string[] = [];

  // ---- HTTP chains ----
  for (const listener of httpListeners) {
    const chain = reachable(workflow, listener.id);
    const domain = firstOfType(chain, "Domain");
    const ssl = firstOfType(chain, "SSL");
    const rateLimit = firstOfType(chain, "RateLimit");
    const cache = firstOfType(chain, "Cache");
    const lb = firstOfType(chain, "LB");
    const backends = chain.filter((n) => n.type === "Backend");
    const grpcs = chain.filter((n) => n.type === "GRPC");
    const routes = chain.filter((n) => n.type === "Route");
    const auth = firstOfType(chain, "Auth");

    // Top-level http {} directives
    if (rateLimit) {
      httpTop.push(
        `limit_req_zone ${get(rateLimit, "key")} zone=${get(rateLimit, "zoneName")}:${get(rateLimit, "zoneSizeMb")}m rate=${get(rateLimit, "rate")};`,
      );
    }
    if (cache) {
      httpTop.push(
        `proxy_cache_path /var/cache/nginx/${get(cache, "zoneName")} levels=1:2 keys_zone=${get(cache, "zoneName")}:${get(cache, "zoneSizeMb")}m inactive=${get(cache, "inactive")};`,
      );
    }

    // Upstream
    let proxyTarget = "";
    if (lb && backends.length) {
      const upName = get<string>(lb, "name", "upstream_pool");
      const upstream: string[] = [];
      upstream.push(`upstream ${upName} {`);
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
      httpTop.push(upstream.join("\n"));
      proxyTarget = `http://${upName}`;
    } else if (backends.length) {
      const b = backends[0];
      proxyTarget = `http://${get(b, "address")}:${get(b, "port")}`;
    }

    // Server block
    const srv: string[] = [];
    srv.push("server {");
    const listenParts: string[] = [`${get(listener, "port")}`];
    if (get(listener, "protocol") === "https") listenParts.push("ssl");
    if (get<boolean>(listener, "http2")) listenParts.push("http2");
    if (get<boolean>(listener, "defaultServer")) listenParts.push("default_server");
    if (get<boolean>(listener, "proxyProtocol")) listenParts.push("proxy_protocol");
    if (get<boolean>(listener, "reuseport")) listenParts.push("reuseport");
    srv.push(line(1, `listen ${listenParts.join(" ")};`));

    if (domain) {
      const hosts = get<string[]>(domain, "hostnames", []);
      srv.push(line(1, `server_name ${hosts.join(" ")};`));
    }

    if (ssl && get(listener, "protocol") === "https") {
      const isLe = Boolean(get<boolean>(ssl, "leMode"));
      const leIssued = isLe && String(get<string>(ssl, "leStatus", "")) === "issued";
      let certRef = "";
      let keyRef = "";
      if (leIssued) {
        certRef = get<string>(ssl, "certPath", "") || "/etc/letsencrypt/live/<domain>/fullchain.pem";
        keyRef = get<string>(ssl, "keyPath", "") || "/etc/letsencrypt/live/<domain>/privkey.pem";
      } else if (isLe) {
        certRef = "/etc/letsencrypt/live/<pending>/fullchain.pem";
        keyRef = "/etc/letsencrypt/live/<pending>/privkey.pem";
      } else {
        // Manual: inline PEM stored by backend, resolved to a managed path at deploy time.
        srv.push(line(1, `# TLS material provided inline; backend writes it to a managed path.`));
        certRef = `/etc/nginx/managed/${ssl.id}/fullchain.pem`;
        keyRef = `/etc/nginx/managed/${ssl.id}/privkey.pem`;
      }
      srv.push(line(1, `ssl_certificate ${certRef};`));
      srv.push(line(1, `ssl_certificate_key ${keyRef};`));
      const protos = get<string[]>(ssl, "protocols", []);
      if (protos.length) srv.push(line(1, `ssl_protocols ${protos.join(" ")};`));
      const ciphers = get<string>(ssl, "ciphers", "");
      if (ciphers) srv.push(line(1, `ssl_ciphers ${ciphers};`));
      if (get<boolean>(ssl, "preferServerCiphers"))
        srv.push(line(1, `ssl_prefer_server_ciphers on;`));
      if (get<boolean>(ssl, "hsts"))
        srv.push(
          line(
            1,
            `add_header Strict-Transport-Security "max-age=${get(ssl, "hstsMaxAge")}; includeSubDomains" always;`,
          ),
        );
      srv.push(...extras(1, ssl));
    }

    srv.push(...extras(1, listener));
    if (domain) srv.push(...extras(1, domain));

    // Locations
    const effectiveRoutes = routes.length ? routes : [null];
    for (const r of effectiveRoutes) {
      const path = r ? get<string>(r, "path", "/") : "/";
      const prefix = r ? locationPrefix(get<string>(r, "matchMode", "prefix")) : "";
      srv.push(line(1, `location ${prefix}${path} {`));

      if (auth) {
        const t = get<string>(auth, "type");
        if (t === "basic") {
          srv.push(line(2, `auth_basic "${get(auth, "realm")}";`));
          srv.push(line(2, `auth_basic_user_file ${get(auth, "userFile")};`));
        } else if (t === "ip-allowlist") {
          for (const cidr of get<string[]>(auth, "allowList", []))
            srv.push(line(2, `allow ${cidr};`));
          srv.push(line(2, `deny all;`));
        } else if (t === "jwt") {
          srv.push(line(2, `auth_jwt "closed area";`));
          srv.push(line(2, `# auth_jwt_key_request /_jwks;   # points to ${get(auth, "jwksUri")}`));
        } else if (t === "subrequest") {
          srv.push(line(2, `auth_request ${get(auth, "subrequestUri")};`));
        }
        srv.push(...extras(2, auth));
      }

      if (rateLimit) {
        const parts = [`zone=${get(rateLimit, "zoneName")}`, `burst=${get(rateLimit, "burst")}`];
        if (get<boolean>(rateLimit, "nodelay")) parts.push("nodelay");
        srv.push(line(2, `limit_req ${parts.join(" ")};`));
      }

      if (cache) {
        srv.push(line(2, `proxy_cache ${get(cache, "zoneName")};`));
        srv.push(line(2, `proxy_cache_valid ${get(cache, "validCodes")};`));
        srv.push(line(2, `proxy_cache_key ${get(cache, "key")};`));
        const bypass = get<string>(cache, "bypass", "");
        if (bypass) srv.push(line(2, `proxy_cache_bypass ${bypass};`));
      }

      if (r) {
        const rewrite = get<string>(r, "rewrite", "");
        const tryFiles = get<string>(r, "tryFiles", "");
        if (rewrite) srv.push(line(2, `rewrite ${rewrite};`));
        if (tryFiles) srv.push(line(2, `try_files ${tryFiles};`));
        srv.push(...extras(2, r));
      }

      if (grpcs.length) {
        const g = grpcs[0];
        for (const h of get<HeaderEntry[]>(g, "grpcHeaders", [])) {
          if (h?.name && h?.value)
            srv.push(line(2, `grpc_set_header ${h.name} "${h.value}";`));
        }
        srv.push(line(2, `grpc_connect_timeout ${get(g, "connectTimeout")};`));
        srv.push(line(2, `grpc_read_timeout ${get(g, "readTimeout")};`));
        srv.push(line(2, `grpc_send_timeout ${get(g, "sendTimeout")};`));
        const scheme = get<boolean>(g, "tls") ? "grpcs" : "grpc";
        srv.push(line(2, `grpc_pass ${scheme}://${get(g, "address")}:${get(g, "port")};`));
        srv.push(...extras(2, g));
      } else if (backends.length) {
        const first = backends[0];
        for (const h of get<HeaderEntry[]>(first, "proxyHeaders", [])) {
          if (h?.name && h?.value)
            srv.push(line(2, `proxy_set_header ${h.name} "${h.value}";`));
        }
        srv.push(line(2, `proxy_connect_timeout ${get(first, "connectTimeout")};`));
        srv.push(line(2, `proxy_read_timeout ${get(first, "readTimeout")};`));
        if (proxyTarget) srv.push(line(2, `proxy_pass ${proxyTarget};`));
        srv.push(...extras(2, first));
      }

      srv.push(line(1, `}`));
    }

    srv.push("}");
    httpServers.push(srv.join("\n"));
  }

  // ---- Stream chains ----
  for (const l of [...tcpListeners, ...udpListeners]) {
    const chain = reachable(workflow, l.id);
    const backends = chain.filter((n) => n.type === "Backend");
    const s: string[] = [];
    s.push(line(1, "server {"));
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

  const out: string[] = [];
  out.push("# Generated by ProxyForge — preview only");
  out.push("# workflow: " + workflow.name + " (v" + workflow.version + ")");
  out.push("");
  if (httpServers.length) {
    out.push("http {");
    for (const t of httpTop) {
      for (const l of t.split("\n")) out.push(line(1, l));
    }
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
