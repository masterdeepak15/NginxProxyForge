import type { Workflow, WorkflowNode, NodeType } from "@/services/api";
import {
  domainsForListener,
  partitionDomain,
  domainLogFile,
  domainErrorLogFile,
  locationLogFile,
} from "./graphScope";

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
  return ids
    .map((i) => wf.nodes.find((n) => n.id === i))
    .filter((n): n is WorkflowNode => Boolean(n));
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

// A proxy_pass/grpc_pass target only needs an explicit port when it isn't
// the scheme's conventional default (http/grpc -> 80, https/grpcs -> 443).
// Any other port must stay explicit. This intentionally does NOT apply to
// the `server host:port;` lines inside an upstream{} block (see below) —
// nginx defaults an omitted upstream server port to 80 regardless of the
// scheme used in proxy_pass, so omitting it there for an https/443 backend
// would silently break it.
function isDefaultPort(scheme: string, port: unknown): boolean {
  const p = Number(port);
  if (scheme === "http" || scheme === "grpc") return p === 80;
  if (scheme === "https" || scheme === "grpcs") return p === 443;
  return false;
}
function target(scheme: string, address: unknown, port: unknown): string {
  return isDefaultPort(scheme, port) ? `${scheme}://${address}` : `${scheme}://${address}:${port}`;
}

// "Block Common Exploits" — mirrors the NPM toggle of the same name: a
// standard set of server-level rules blocking common exploit probes (path
// traversal, GLOBALS/_REQUEST injection attempts, direct requests for
// dotfiles / wp-config.php). Applied per-domain (server{} scope), not
// per-route, matching how NPM scopes it to the whole proxy host.
function blockExploitsLines(depth: number): string[] {
  const out: string[] = [line(depth, "# Block common exploits")];
  const queryPatterns = [
    String.raw`[|]`,
    String.raw`\.\.\/`,
    String.raw`boot\.ini`,
    String.raw`etc\/passwd`,
    String.raw`GLOBALS(=|\[|\%[0-9A-Z]{0,2})`,
    String.raw`_REQUEST(=|\[|\%[0-9A-Z]{0,2})`,
  ];
  for (const p of queryPatterns) {
    out.push(line(depth, `if ($query_string ~ "${p}") { return 403; }`));
  }
  out.push(
    line(depth, `location ~* /(\\.htaccess|\\.htpasswd|\\.git|\\.svn|\\.env|wp-config\\.php)$ {`),
  );
  out.push(line(depth + 1, "deny all;"));
  out.push(line(depth + 1, "return 403;"));
  out.push(line(depth, "}"));
  return out;
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
    proxyTarget = target(backendScheme(b), get(b, "address"), get(b, "port"));
  }

  lines.push(line(2, `access_log /data/logs/${logFiles.domain} pf;`));
  lines.push(line(2, `access_log /data/logs/${logFiles.location} pf;`));

  if (auth) {
    const t = get<string>(auth, "type");
    if (t === "basic") {
      lines.push(line(2, `auth_basic "${get(auth, "realm")}";`));
      lines.push(line(2, `auth_basic_user_file ${get(auth, "userFile")};`));
    } else if (t === "ip-allowlist") {
      for (const cidr of get<string[]>(auth, "allowList", []))
        lines.push(line(2, `allow ${cidr};`));
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
    lines.push(line(2, `grpc_pass ${target(scheme, get(g, "address"), get(g, "port"))};`));
    lines.push(...extras(2, g));
  } else if (backends.length) {
    const first = backends[0];
    for (const h of get<HeaderEntry[]>(first, "proxyHeaders", [])) {
      if (h?.name && h?.value) lines.push(line(2, `proxy_set_header ${h.name} "${h.value}";`));
    }
    if (get<boolean>(first, "websocket")) {
      lines.push(line(2, "proxy_http_version 1.1;"));
      lines.push(line(2, "proxy_set_header Upgrade $http_upgrade;"));
      lines.push(line(2, 'proxy_set_header Connection "upgrade";'));
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

  // Force SSL: this listener is plain HTTP and the domain's SSL node has
  // the redirect toggle on — this server block's only job is the 301,
  // skip cert/location/backend generation for it entirely.
  if (ssl && get<boolean>(ssl, "forceSsl") && get(listener, "protocol") !== "https") {
    srv.push(line(1, "return 301 https://$host$request_uri;"));
    srv.push("}");
    return { serverBlock: srv.join("\n"), topLevel: [] };
  }

  srv.push(
    line(1, `error_log /data/logs/${domainErrorLogFile(wf.id, listener.id, domain.id)} warn;`),
  );

  if (ssl && get(listener, "protocol") === "https") {
    const isLe = Boolean(get<boolean>(ssl, "leMode"));
    const leIssued = isLe && String(get<string>(ssl, "leStatus", "")) === "issued";
    let certRef = "";
    let keyRef = "";
    if (leIssued) {
      certRef =
        get<string>(ssl, "certPath", "") ||
        "/data/certs/letsencrypt/config/live/<domain>/fullchain.pem";
      keyRef =
        get<string>(ssl, "keyPath", "") ||
        "/data/certs/letsencrypt/config/live/<domain>/privkey.pem";
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
  srv.push(...extras(1, domain));

  if (get<boolean>(domain, "blockExploits")) {
    srv.push(...blockExploitsLines(1));
  }

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

// Escapes a string for embedding in an nginx double-quoted "complex value"
// (used by return/add_header/etc.) — those strings interpolate $variables,
// so a literal `$` in user-supplied HTML (common in inline JS) would
// otherwise get silently substituted or blow up the config. Backslash
// must be escaped first so the escapes added below aren't re-escaped.
function escapeNginxDoubleQuoted(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$");
}

const DEFAULT_SITE_CONGRATULATIONS_HTML =
  "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Welcome</title>" +
  "<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;" +
  "display:flex;align-items:center;justify-content:center;height:100vh;margin:0}" +
  ".box{text-align:center}h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#94a3b8}" +
  "</style></head><body><div class='box'><h1>It works!</h1>" +
  "<p>No site is configured for this host yet.</p></div></body></html>";

const DEFAULT_SITE_404_HTML =
  "<!DOCTYPE html><html><head><meta charset='utf-8'><title>404 Not Found</title>" +
  "<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;" +
  "display:flex;align-items:center;justify-content:center;height:100vh;margin:0}" +
  ".box{text-align:center}h1{font-size:2.5rem;margin-bottom:.5rem}p{color:#94a3b8}" +
  "</style></head><body><div class='box'><h1>404</h1>" +
  "<p>Nothing here matches that request.</p></div></body></html>";

// Content for a DefaultSite's server{} block, per its `mode`. Mirrors NPM's
// "Default Site" options (Congratulations / 404 / No Response / Redirect /
// Custom Page).
function defaultSiteContentLines(depth: number, node: WorkflowNode): string[] {
  const mode = get<string>(node, "mode", "congratulations");
  const out: string[] = [];
  if (mode === "no-response") {
    // nginx's dedicated "close the connection, send nothing" status.
    out.push(line(depth, "return 444;"));
    return out;
  }
  if (mode === "redirect") {
    const code = get<string>(node, "redirectCode", "302");
    const url = get<string>(node, "redirectUrl", "");
    out.push(line(depth, `return ${code} "${escapeNginxDoubleQuoted(url)}";`));
    return out;
  }
  out.push(line(depth, "default_type text/html;"));
  if (mode === "404") {
    out.push(line(depth, `return 404 "${escapeNginxDoubleQuoted(DEFAULT_SITE_404_HTML)}";`));
  } else if (mode === "custom") {
    out.push(
      line(depth, `return 200 "${escapeNginxDoubleQuoted(get<string>(node, "html", ""))}";`),
    );
  } else {
    out.push(
      line(depth, `return 200 "${escapeNginxDoubleQuoted(DEFAULT_SITE_CONGRATULATIONS_HTML)}";`),
    );
  }
  return out;
}

// A DefaultSite is a Listener's `default_server` catch-all — its own
// server{} block, not tied to any Domain/hostname. For an https Listener
// the TLS handshake still needs *some* certificate, so we borrow one from
// a sibling Domain's SSL node on the same Listener if one exists.
function buildDefaultSiteServer(wf: Workflow, listener: WorkflowNode, node: WorkflowNode): string {
  const srv: string[] = ["server {"];
  const isHttps = get(listener, "protocol") === "https";
  const listenParts: string[] = [`${get(listener, "port")}`];
  if (isHttps) listenParts.push("ssl");
  if (get<boolean>(listener, "http2")) listenParts.push("http2");
  listenParts.push("default_server");
  if (get<boolean>(listener, "proxyProtocol")) listenParts.push("proxy_protocol");
  if (get<boolean>(listener, "reuseport")) listenParts.push("reuseport");
  srv.push(line(1, `listen ${listenParts.join(" ")};`));
  srv.push(line(1, "server_name _;"));

  if (isHttps) {
    const siblingDomain = domainsForListener(wf, listener.id).find((d) =>
      outgoing(wf, d.id).some((n) => n.type === "SSL"),
    );
    const ssl = siblingDomain
      ? outgoing(wf, siblingDomain.id).find((n) => n.type === "SSL")
      : undefined;
    if (ssl) {
      const isLe = Boolean(get<boolean>(ssl, "leMode"));
      const leIssued = isLe && String(get<string>(ssl, "leStatus", "")) === "issued";
      let certRef = "";
      let keyRef = "";
      if (leIssued) {
        certRef =
          get<string>(ssl, "certPath", "") ||
          "/data/certs/letsencrypt/config/live/<domain>/fullchain.pem";
        keyRef =
          get<string>(ssl, "keyPath", "") ||
          "/data/certs/letsencrypt/config/live/<domain>/privkey.pem";
      } else if (isLe) {
        certRef = "/data/certs/letsencrypt/config/live/<pending>/fullchain.pem";
        keyRef = "/data/certs/letsencrypt/config/live/<pending>/privkey.pem";
      } else {
        certRef = `/data/certs/managed/${ssl.id}/fullchain.pem`;
        keyRef = `/data/certs/managed/${ssl.id}/privkey.pem`;
      }
      srv.push(line(1, `ssl_certificate ${certRef};`));
      srv.push(line(1, `ssl_certificate_key ${keyRef};`));
    } else {
      srv.push(
        line(
          1,
          "# No certificate available on this Listener yet — add an SSL node to a Domain here first.",
        ),
      );
      srv.push(
        line(1, `ssl_certificate /data/certs/managed/defaultsite_${node.id}/fullchain.pem;`),
      );
      srv.push(
        line(1, `ssl_certificate_key /data/certs/managed/defaultsite_${node.id}/privkey.pem;`),
      );
    }
  }

  srv.push(...defaultSiteContentLines(1, node));
  srv.push(...extras(1, node));
  srv.push("}");
  return srv.join("\n");
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
    const defaultSite = outgoing(workflow, listener.id).find((n) => n.type === "DefaultSite");
    if (defaultSite) {
      httpServers.push(buildDefaultSiteServer(workflow, listener, defaultSite));
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
