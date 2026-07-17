// Minimal Node HTTP server that wraps ProxyForge UI's built TanStack Start
// server bundle (dist/server/server.js, a Web-standard { fetch } handler)
// and serves the static client assets (dist/client) in front of it.
//
// Runs as its own process (see docker/entrypoint.sh) behind the container's
// real nginx, which reverse-proxies the admin dashboard port (81) to this
// server plus the API server. Not used in `bun run dev` (Vite's dev server
// handles both there).
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import serveStatic from "serve-static";
import finalhandler from "finalhandler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, "dist", "client");
const serve = serveStatic(clientDir, { index: false, redirect: false });

const { default: handler } = await import("./dist/server/server.js");

function nodeRequestToWebRequest(req) {
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["host"] || "localhost";
  const url = `${protocol}://${host}${req.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else headers.set(key, value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? req : undefined,
    duplex: hasBody ? "half" : undefined,
  });
}

async function webResponseToNodeResponse(webRes, res) {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => res.setHeader(key, value));
  if (!webRes.body) {
    res.end();
    return;
  }
  const reader = webRes.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

const server = createServer((req, res) => {
  serve(req, res, async () => {
    try {
      const webRequest = nodeRequestToWebRequest(req);
      const webResponse = await handler.fetch(webRequest, {}, {});
      await webResponseToNodeResponse(webResponse, res);
    } catch (err) {
      console.error("[ui-server] request failed", err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });
});

const PORT = Number(process.env.UI_PORT || 3000);
server.listen(PORT, () => {
  console.log(`ProxyForge UI server listening on :${PORT}`);
});
