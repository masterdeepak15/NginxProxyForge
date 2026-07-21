import { randomUUID } from "crypto";
import type { WorkflowNode, WorkflowEdge } from "../types";

// A minimal nginx-config parser: tokenizes into a generic directive AST
// (name + args, optionally with a nested block), then walks server{} /
// location{} blocks to build a ProxyForge node graph. This covers the
// common shape of hand-written configs and Nginx Proxy Manager exports
// (listen, server_name, ssl_certificate[_key], location + proxy_pass).
// It does NOT resolve `include` directives, upstream{} blocks, or
// stream{}/L4 config — those need to be added manually after import.

interface Directive {
  name: string;
  args: string[];
  block?: Directive[];
}

function tokenize(text: string): string[] {
  let stripped = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    if (c === '"' && !inSingle) inDouble = !inDouble;
    if (c === "#" && !inSingle && !inDouble) {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    stripped += c;
  }

  const tokens: string[] = [];
  let cur = "";
  inSingle = false;
  inDouble = false;
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      cur += c;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      cur += c;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (c === "{" || c === "}" || c === ";") {
        if (cur.trim()) tokens.push(cur.trim());
        tokens.push(c);
        cur = "";
        continue;
      }
      if (/\s/.test(c)) {
        if (cur) {
          tokens.push(cur);
          cur = "";
        }
        continue;
      }
    }
    cur += c;
  }
  if (cur.trim()) tokens.push(cur.trim());
  return tokens;
}

function parseBlock(tokens: string[], pos: { i: number }): Directive[] {
  const out: Directive[] = [];
  while (pos.i < tokens.length) {
    const t = tokens[pos.i];
    if (t === "}") {
      pos.i++;
      return out;
    }
    const parts: string[] = [];
    while (pos.i < tokens.length && tokens[pos.i] !== ";" && tokens[pos.i] !== "{") {
      parts.push(tokens[pos.i]);
      pos.i++;
    }
    if (parts.length === 0) {
      pos.i++;
      continue;
    }
    const [name, ...args] = parts;
    if (tokens[pos.i] === "{") {
      pos.i++;
      const block = parseBlock(tokens, pos);
      out.push({ name, args, block });
    } else if (tokens[pos.i] === ";") {
      pos.i++;
      out.push({ name, args });
    }
  }
  return out;
}

function unquote(s: string): string {
  return s.replace(/^["']|["']$/g, "");
}

function parseNginxConfigToAst(text: string): Directive[] {
  const tokens = tokenize(text);
  return parseBlock(tokens, { i: 0 });
}

function findAll(dirs: Directive[], name: string): Directive[] {
  let out: Directive[] = [];
  for (const d of dirs) {
    if (d.name === name) out.push(d);
    if (d.block) out = out.concat(findAll(d.block, name));
  }
  return out;
}

interface HeaderEntry {
  name: string;
  value: string;
}

// Nginx Proxy Manager's exported proxy-host template doesn't put a literal
// `proxy_pass` in the location block. Instead it sets these three variables
// at the server level and the location just does
// `include conf.d/include/proxy.conf;` (the file that actually contains
// `proxy_pass $forward_scheme://$server:$port;` — not part of a per-host
// export, so we never see its contents, only the reference to it).
function getSetVar(block: Directive[], varName: string): string | undefined {
  const d = block.find((x) => x.name === "set" && x.args[0] === `$${varName}`);
  return d ? unquote(d.args[1] ?? "") : undefined;
}

function hasInclude(block: Directive[] | undefined, pattern: RegExp): boolean {
  return (block || []).some((d) => d.name === "include" && pattern.test(d.args[0] || ""));
}

function collectHeaders(block: Directive[] | undefined, directiveName: string): HeaderEntry[] {
  return (block || [])
    .filter((d) => d.name === directiveName && d.args.length >= 2)
    .map((d) => ({ name: d.args[0], value: unquote(d.args[1]) }));
}

// A server{} block that only answers the ACME HTTP-01 challenge and/or
// redirects to HTTPS, with no real backend of its own. NPM's SSL+force-SSL
// hosts merge this into the same server block as the real content (handled
// by the multi-listen-port logic below), but hand-written / certbot-standalone
// configs sometimes split it into its own server{} — ProxyForge already
// answers ACME challenges and redirects to HTTPS automatically once an SSL
// node is attached (see docker/nginx.conf default server), so importing
// these as empty, backend-less Route nodes would just be noise.
function isRedirectOnlyStub(server: Directive): boolean {
  if (server.block!.some((d) => d.name === "ssl_certificate")) return false;
  const locations = server.block!.filter((d) => d.name === "location");
  if (!locations.length) return false;
  return locations.every((loc) => {
    const path = unquote(loc.args[loc.args.length - 1] || "/");
    const hasBackend = (loc.block || []).some((d) => d.name === "proxy_pass" || d.name === "grpc_pass");
    if (hasBackend) return false;
    if (/well-known\/acme-challenge/.test(path)) return true;
    return (loc.block || []).some((d) => d.name === "return");
  });
}

export interface ImportResult {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  warnings: string[];
}

export function importNginxConfig(text: string): ImportResult {
  const ast = parseNginxConfigToAst(text);
  const allServers = findAll(ast, "server").filter((s) => s.block?.some((d) => d.name === "listen"));
  const warnings: string[] = [];

  if (findAll(ast, "upstream").length) {
    warnings.push("upstream{} blocks were found but are not imported — add a Load Balancer node manually.");
  }
  if (findAll(ast, "stream").length) {
    warnings.push("stream{} (TCP/UDP) config was found but is not imported — add TCP/UDP nodes manually.");
  }
  if (!allServers.length) {
    warnings.push("No server{} blocks with a listen directive were found.");
  }

  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  const nid = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`;

  const servers = allServers.filter((server) => {
    if (!isRedirectOnlyStub(server)) return true;
    const name = unquote(server.block!.find((d) => d.name === "server_name")?.args[0] || "unknown host");
    warnings.push(
      `Skipped a redirect-only :80 server block for ${name} (ACME challenge + HTTPS redirect, no backend) — ` +
        `ProxyForge serves ACME challenges and redirects to HTTPS automatically once an SSL node is attached.`,
    );
    return false;
  });

  let listenerX = 40;
  for (const server of servers) {
    const listenDirs = server.block!.filter((d) => d.name === "listen");
    const http2Dir = server.block!.find((d) => d.name === "http2");
    const bareHttp2 = http2Dir ? http2Dir.args[0] !== "off" : false;

    // NPM (and modern hand-written configs) can list several `listen`
    // lines for the *same* server block (e.g. 80 + [::]:80 + 443 ssl +
    // [::]:443 ssl all in one block, with a force-ssl include handling the
    // redirect). Each distinct port becomes its own Listener node, all
    // pointing at the same Domain — instead of the old behavior of only
    // ever looking at the first `listen` line and mislabeling the domain's
    // plain :80 socket as "HTTPS" whenever any ssl_certificate existed
    // anywhere in the block.
    const portMap = new Map<number, { ssl: boolean; http2: boolean }>();
    for (const listenDir of listenDirs) {
      const listenArg = listenDir.args[0] || "80";
      const portMatch = listenArg.match(/(\d+)/);
      const port = portMatch ? Number(portMatch[1]) : 80;
      const ssl = listenDir.args.includes("ssl");
      const http2 = bareHttp2 || listenDir.args.includes("http2");
      const existing = portMap.get(port);
      portMap.set(port, {
        ssl: (existing?.ssl ?? false) || ssl,
        http2: (existing?.http2 ?? false) || http2,
      });
    }

    const serverNameDir = server.block!.find((d) => d.name === "server_name");
    const hostnames = (serverNameDir?.args || []).map(unquote).filter((a) => a && a !== "_");
    const domainId = nid("domain");
    nodes.push({
      id: domainId,
      type: "Domain",
      label: hostnames[0] || "imported-domain",
      x: listenerX + 220,
      y: 40,
      properties: { hostnames: hostnames.length ? hostnames : ["example.com"] },
    });

    let listenerY = 40;
    for (const [port, { ssl, http2 }] of portMap) {
      const listenerId = nid("listener");
      nodes.push({
        id: listenerId,
        type: "Listener",
        label: `${ssl ? "HTTPS" : "HTTP"} :${port}`,
        x: listenerX,
        y: listenerY,
        properties: { port, protocol: ssl ? "https" : "http", http2 },
      });
      edges.push({ id: nid("e"), from: listenerId, to: domainId });
      listenerY += 100;
    }

    if (hasInclude(server.block, /force-ssl\.conf/)) {
      warnings.push(
        `${hostnames[0] || "This host"} redirects HTTP → HTTPS (NPM "Force SSL") — that redirect isn't a ` +
          `modeled node property yet; the domain now has both an HTTP and an HTTPS Listener, but the actual ` +
          `301 redirect needs to be recreated by hand if required.`,
      );
    }
    if (hasInclude(server.block, /assets\.conf|block-exploits\.conf/)) {
      warnings.push(
        `${hostnames[0] || "This host"} used NPM's "Cache Assets" / "Block Common Exploits" toggles — ` +
          `there's no equivalent ProxyForge node property yet; add the relevant rules via a Route's extraDirectives if needed.`,
      );
    }

    const certDir = server.block!.find((d) => d.name === "ssl_certificate");
    const keyDir = server.block!.find((d) => d.name === "ssl_certificate_key");
    if (certDir || keyDir) {
      const sslId = nid("ssl");
      nodes.push({
        id: sslId,
        type: "SSL",
        label: "Imported certificate",
        x: listenerX + 220,
        y: -80,
        properties: {
          leMode: false,
          certPath: certDir ? unquote(certDir.args[0] || "") : "",
          keyPath: keyDir ? unquote(keyDir.args[0] || "") : "",
        },
      });
      edges.push({ id: nid("e"), from: domainId, to: sslId });
      warnings.push(
        `${hostnames[0] || "This host"}: the certificate/key file paths were imported as text, but the actual ` +
          `PEM files aren't part of a .conf export — re-issue via Let's Encrypt or upload the cert/key manually.`,
      );
    }

    const locations = server.block!.filter((d) => d.name === "location");
    let yOffset = 160;
    for (const loc of locations) {
      const rawPath = unquote(loc.args[loc.args.length - 1] || "/");
      let matchMode = "prefix";
      if (loc.args[0] === "=") matchMode = "exact";
      else if (loc.args[0] === "^~") matchMode = "preferential";
      else if (loc.args[0] === "~") matchMode = "regex";
      else if (loc.args[0] === "~*") matchMode = "regex-ci";

      const routeId = nid("route");
      nodes.push({
        id: routeId,
        type: "Route",
        label: rawPath,
        x: listenerX + 440,
        y: yOffset,
        properties: { path: rawPath, matchMode },
      });
      edges.push({ id: nid("e"), from: domainId, to: routeId });

      const proxyPassDir = loc.block?.find((d) => d.name === "proxy_pass");
      const grpcPassDir = loc.block?.find((d) => d.name === "grpc_pass");
      const usesSharedProxyInclude = hasInclude(loc.block, /proxy\.conf/);

      if (grpcPassDir) {
        const target = unquote(grpcPassDir.args[0] || "");
        const m = target.match(/^(grpcs?):\/\/([^/:]+)(?::(\d+))?/);
        const tls = m?.[1] === "grpcs";
        const address = m?.[2] || target || "grpc-service";
        const port = m?.[3] ? Number(m[3]) : 50051;
        const grpcId = nid("grpc");
        const grpcHeaders = collectHeaders(loc.block, "grpc_set_header");
        nodes.push({
          id: grpcId,
          type: "GRPC",
          label: address,
          x: listenerX + 660,
          y: yOffset,
          properties: {
            address,
            port,
            tls,
            connectTimeout: loc.block?.find((d) => d.name === "grpc_connect_timeout")?.args[0] || "5s",
            readTimeout: loc.block?.find((d) => d.name === "grpc_read_timeout")?.args[0] || "60s",
            sendTimeout: loc.block?.find((d) => d.name === "grpc_send_timeout")?.args[0] || "60s",
            ...(grpcHeaders.length ? { grpcHeaders } : {}),
          },
        });
        edges.push({ id: nid("e"), from: routeId, to: grpcId });
      } else if (proxyPassDir) {
        const target = unquote(proxyPassDir.args[0] || "");
        const m = target.match(/^(https?):\/\/([^/:]+)(?::(\d+))?/);
        const scheme = m?.[1] === "https" ? "https" : "http";
        const address = m?.[2] || target || "backend";
        const port2 = m?.[3] ? Number(m[3]) : scheme === "https" ? 443 : 80;
        const backendId = nid("backend");
        // A literal proxy_pass with no shared-include means this location's
        // header set is fully explicit in the source file — capture it
        // literally rather than layering ProxyForge's own defaults on top,
        // since e.g. an NPM host might deliberately forward only one or two
        // custom headers and nothing else.
        const explicitHeaders = usesSharedProxyInclude ? [] : collectHeaders(loc.block, "proxy_set_header");
        nodes.push({
          id: backendId,
          type: "Backend",
          label: address,
          x: listenerX + 660,
          y: yOffset,
          properties: {
            address,
            port: port2,
            scheme,
            weight: 1,
            maxFails: 3,
            failTimeout: "10s",
            connectTimeout: "5s",
            readTimeout: "60s",
            ...(explicitHeaders.length ? { proxyHeaders: explicitHeaders } : {}),
          },
        });
        edges.push({ id: nid("e"), from: routeId, to: backendId });
      } else if (usesSharedProxyInclude) {
        // NPM's template: no literal proxy_pass, just `set $forward_scheme
        // / $server / $port` at the server level and `include
        // conf.d/include/proxy.conf` in the location, which is where NPM's
        // shared file actually does `proxy_pass $forward_scheme://$server:$port;`.
        const scheme = getSetVar(server.block!, "forward_scheme") === "https" ? "https" : "http";
        const address = getSetVar(server.block!, "server") || "backend";
        const portStr = getSetVar(server.block!, "port");
        const port2 = portStr ? Number(portStr) : scheme === "https" ? 443 : 80;
        const backendId = nid("backend");
        nodes.push({
          id: backendId,
          type: "Backend",
          label: address,
          x: listenerX + 660,
          y: yOffset,
          properties: {
            address,
            port: port2,
            scheme,
            weight: 1,
            maxFails: 3,
            failTimeout: "10s",
            connectTimeout: "5s",
            readTimeout: "60s",
          },
        });
        edges.push({ id: nid("e"), from: routeId, to: backendId });
        if ((loc.block || []).some((d) => d.name === "proxy_set_header")) {
          warnings.push(
            `${rawPath} on ${hostnames[0] || "this host"} sets extra proxy headers (e.g. WebSocket Upgrade/` +
              `Connection) alongside NPM's shared proxy include — these weren't imported; add them under the ` +
              `Backend node's proxy_set_header field manually if this route needs WebSocket support.`,
          );
        }
      } else {
        warnings.push(`location ${rawPath} on ${hostnames[0] || "this host"} has no proxy_pass/grpc_pass — imported without a Backend node.`);
      }
      yOffset += 140;
    }

    listenerX += 900;
  }

  return { nodes, edges, warnings };
}
