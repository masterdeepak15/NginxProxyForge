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

export interface ImportResult {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  warnings: string[];
}

export function importNginxConfig(text: string): ImportResult {
  const ast = parseNginxConfigToAst(text);
  const servers = findAll(ast, "server").filter((s) => s.block?.some((d) => d.name === "listen"));
  const warnings: string[] = [];

  if (findAll(ast, "upstream").length) {
    warnings.push("upstream{} blocks were found but are not imported — add a Load Balancer node manually.");
  }
  if (findAll(ast, "stream").length) {
    warnings.push("stream{} (TCP/UDP) config was found but is not imported — add TCP/UDP nodes manually.");
  }
  if (!servers.length) {
    warnings.push("No server{} blocks with a listen directive were found.");
  }

  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  const nid = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`;

  let listenerX = 40;
  for (const server of servers) {
    const listenDir = server.block!.find((d) => d.name === "listen")!;
    const listenArg = listenDir.args[0] || "80";
    const portMatch = listenArg.match(/(\d+)/);
    const port = portMatch ? Number(portMatch[1]) : 80;
    const isSsl = listenDir.args.includes("ssl") || (server.block || []).some((d) => d.name === "ssl_certificate");

    const listenerId = nid("listener");
    nodes.push({
      id: listenerId,
      type: "Listener",
      label: `${isSsl ? "HTTPS" : "HTTP"} :${port}`,
      x: listenerX,
      y: 40,
      properties: { port, protocol: isSsl ? "https" : "http", http2: listenDir.args.includes("http2") },
    });

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
    edges.push({ id: nid("e"), from: listenerId, to: domainId });

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
      if (proxyPassDir) {
        const target = unquote(proxyPassDir.args[0] || "");
        const m = target.match(/^(https?):\/\/([^/:]+)(?::(\d+))?/);
        const scheme = m?.[1] === "https" ? "https" : "http";
        const address = m?.[2] || target || "backend";
        const port2 = m?.[3] ? Number(m[3]) : scheme === "https" ? 443 : 80;
        const backendId = nid("backend");
        nodes.push({
          id: backendId,
          type: "Backend",
          label: address,
          x: listenerX + 660,
          y: yOffset,
          properties: { address, port: port2, scheme, weight: 1, maxFails: 3, failTimeout: "10s" },
        });
        edges.push({ id: nid("e"), from: routeId, to: backendId });
      } else {
        warnings.push(`location ${rawPath} has no proxy_pass — imported without a Backend node.`);
      }
      yOffset += 140;
    }

    listenerX += 900;
  }

  return { nodes, edges, warnings };
}
