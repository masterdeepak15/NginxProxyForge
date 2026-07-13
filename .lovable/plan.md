
# Workspace v2 — n8n-style Nginx Config Builder

Goal: turn the current static canvas into a real interactive editor where every node maps 1:1 to nginx directives, supports drag/drop from palette, wire-to-wire connections, and rich per-node property forms with validation. Config for the whole workflow can be previewed as generated `nginx.conf`.

## Nginx research (what each node maps to)

| Node | Nginx context | Key directives |
|---|---|---|
| Listener | `server { listen ... }` | `listen`, `http2`, `ssl`, `default_server`, `proxy_protocol`, `reuseport` |
| Domain | `server_name` | `server_name a.com b.com *.c.com` (multi) |
| SSL | `server { ssl_* }` | `ssl_certificate`, `ssl_certificate_key`, `ssl_protocols`, `ssl_ciphers`, `ssl_prefer_server_ciphers`, `ssl_session_cache`, HSTS via `add_header` |
| Route | `location` | `location`, match mode (`=`, `~`, `~*`, `^~`, prefix), `try_files`, `rewrite`, `return`, `proxy_pass` |
| Auth | inside `location` | `auth_basic`, `auth_basic_user_file`, `auth_request`, `allow`/`deny` (IP allowlist), `auth_jwt` (NGINX Plus) or `access_by_lua_*` |
| RateLimit | `http` + `location` | `limit_req_zone`, `limit_req`, `limit_conn_zone`, `limit_conn`, burst, nodelay |
| Cache | `http` + `location` | `proxy_cache_path`, `proxy_cache`, `proxy_cache_valid`, `proxy_cache_key`, `proxy_cache_bypass`, `proxy_cache_use_stale` |
| LB | `upstream {}` | `upstream name { ... }`, `least_conn`/`ip_hash`/`hash`, `server addr weight= max_fails= fail_timeout=`, `keepalive` |
| Backend | `server` inside upstream OR direct `proxy_pass` | address, port, weight, backup, health checks, `proxy_set_header`, `proxy_read_timeout`, `proxy_connect_timeout` |
| TCP | `stream { server { listen ... } }` | stream server, `proxy_pass`, `proxy_timeout` |
| UDP | `stream { server { listen udp; ... } }` | `listen ... udp`, `proxy_responses` |

Every node also gets:
- **Additional headers** (list of `add_header NAME VALUE always?`)
- **Additional directives** (free-form nginx snippet appended inside the node's block)
- **Comment / label**

## Interaction model (n8n-like)

- **Palette → canvas**: drag a node type onto the canvas. Drop position = node position. Uses HTML5 DnD.
- **Move**: drag the node card by its header to reposition (pointer events, updates x/y in Redux).
- **Connect**: each node has a right-side output handle (dot) and a left-side input handle. Mousedown on output → drag → mouseup on input creates an edge. Live cubic-bezier preview follows cursor while dragging.
- **Delete**: select node/edge, press Delete/Backspace, or right-click menu.
- **Select**: click node to open property panel; click empty canvas to deselect.
- **Zoom/pan**: mouse wheel to zoom (0.5–2x), space+drag or middle-click to pan. Grid background scales with zoom.
- **Validation**: each node property has zod schema; invalid props show red ring + inline error, and the node card shows a warning icon.
- **Generated config preview**: toolbar button "View nginx.conf" opens a dialog with a syntax-highlighted generated config from the current graph.

## Files to change / add

- `src/services/api.ts` — extend `WorkflowNode.properties` typing (keep `Record<string, unknown>`), add per-type default properties + zod schemas via a new `nodeSchemas.ts`.
- `src/lib/nodeSchemas.ts` (new) — per-node-type zod schemas + default values + field metadata (label, type: text/number/select/multitext/switch/headers/textarea, options, help).
- `src/lib/nginxGenerator.ts` (new) — walk graph → produce `nginx.conf` string.
- `src/store/slices/workflowsSlice.ts` — add reducers: `addNode`, `moveNode`, `updateNodeProperties`, `deleteNode`, `addEdge`, `deleteEdge`, `setCurrent`.
- `src/routes/_authenticated/workspace.$id.tsx` — rewrite canvas:
  - drag-from-palette (dataTransfer type)
  - node drag-move with pointer events
  - connection handles + live edge preview
  - selection, delete key
  - zoom/pan transform on canvas layer
- `src/components/workspace/NodeCard.tsx` (new) — draggable node with input/output handles, validation badge.
- `src/components/workspace/PropertyPanel.tsx` (new) — renders form fields from the node's schema; supports headers editor and free-form directives textarea.
- `src/components/workspace/NginxPreviewDialog.tsx` (new) — shows generated config in a `<pre>` with copy button.
- `src/components/workspace/FieldRenderer.tsx` (new) — one component per field type (text/number/select/switch/multi-string/headers/textarea) with error display.

## Property schemas (examples)

- **Listener**: `port` (number 1–65535), `protocol` (http|https), `http2` (bool), `defaultServer` (bool), `proxyProtocol` (bool), `reuseport` (bool).
- **Domain**: `hostnames` (string[], min 1, each RFC-1123 or wildcard), `redirectApex` (bool).
- **SSL**: `mode` (shared|per-domain), `certPath`, `keyPath`, `protocols` (multi-select: TLSv1.2/1.3), `ciphers`, `hsts` (bool), `hstsMaxAge` (number).
- **Route**: `path`, `matchMode` (prefix|exact|regex|regex-ci|preferential), `stripPrefix` (bool), `rewrite` (optional), `tryFiles` (optional).
- **Auth**: `type` (none|basic|ip-allowlist|jwt|subrequest), plus type-specific fields (users file, allow list, jwt jwks URL, subrequest URL).
- **RateLimit**: `zoneName`, `zoneSizeMb`, `rate` (e.g. `50r/s`), `burst`, `nodelay` (bool), `key` (`$binary_remote_addr` default).
- **Cache**: `zoneName`, `zoneSizeMb`, `inactive`, `validCodes` (e.g. `200 302 10m`), `key`, `bypass`, `useStale` (multi).
- **LB**: `algorithm` (round-robin|least_conn|ip_hash|hash), `hashKey?`, `keepalive` (number).
- **Backend**: `address`, `port`, `weight`, `maxFails`, `failTimeout`, `backup` (bool), `healthCheck` (bool + path/interval), `proxyHeaders` (headers editor), `readTimeout`, `connectTimeout`.
- **TCP**: `port`, `proxyPass`, `proxyTimeout`, `proxyConnectTimeout`.
- **UDP**: `port`, `proxyPass`, `proxyResponses`, `proxyTimeout`.

All nodes additionally get: `extraHeaders` (headers editor) and `extraDirectives` (textarea).

## Nginx generator sketch

1. Group nodes by connected component starting from Listener/TCP/UDP.
2. For each HTTP listener chain: emit `server { listen ...; server_name ...; ssl_* ...; location <path> { limit_req ...; proxy_cache ...; auth_*; proxy_pass http://<upstream|backend>; add_header ...; <extraDirectives> } }`.
3. If chain has LB node with multiple Backends, emit `upstream <name> { <algo>; server ...; keepalive ... }` at top and use `proxy_pass http://<name>`.
4. Emit `limit_req_zone` and `proxy_cache_path` at `http {}` top level (deduped by zone name).
5. Stream chains (TCP/UDP) emit under `stream { server { ... } }`.
6. Output is a single string; not executed, just previewed.

## Validation

- Use zod `.safeParse` per node on change; store `errors` map in Redux keyed by nodeId.
- Node card shows amber `AlertTriangle` when errors exist.
- Deploy button disabled while any node has errors.

## Non-goals (this pass)

- Real backend / actual nginx reload.
- Undo/redo history.
- Multi-select / group move / copy-paste.
- Snapping / alignment guides.
