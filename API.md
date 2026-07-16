# NginxProxyForge — Backend API Contract

This document specifies the HTTP API the frontend (`src/services/api.ts`)
expects. The current app ships an in-memory dummy implementation; a real
backend must expose the endpoints below with the same request/response
shapes. Update this document every time a new endpoint is added to the UI.

**No hardcoded page data.** Every page in the app reads through
`apiService` — `Login`, `Dashboard`, `Workspace list`, `Workspace editor`
(including per-node live counters), `Deployments`, `Certificates`,
`Metrics`, `Logs`, and `Settings`. The list of demo credentials on the
Login screen is UI copy pointing at seeded users; the credentials
themselves are validated by `POST /auth/login`. When a new UI surface is
added, add its endpoint to section 7 and back it here.

- Base URL: `${API_BASE_URL}` (e.g. `https://api.nginxproxyforge.io`)
- Auth: `Authorization: Bearer <token>` on every non-auth route
- Content-Type: `application/json` (unless noted)
- Errors: `{ "error": { "code": string, "message": string, "details"?: any } }`
  with matching HTTP status (400 / 401 / 403 / 404 / 409 / 422 / 500).



---

## 1. Auth

### POST /auth/login
Body: `{ "email": string, "password": string }`
200: `{ "user": User, "token": string }`
401: invalid credentials.

### POST /auth/logout
200: `{ "ok": true }` — server-side token invalidation.

### GET /auth/me
200: `User` — current session's user (used to hydrate Redux `auth` slice on refresh).

### User
```json
{
  "id": "u_1",
  "email": "admin@proxyforge.io",
  "name": "Alex Morgan",
  "role": "admin" | "operator" | "viewer",
  "avatar": "https://..."   // optional
}
```

---

## 2. Workflows (visual nginx configs)

### GET /workflows
200: `Workflow[]` (list view, includes summary counts).

### GET /workflows/:id
200: `Workflow` (full node/edge graph).

### POST /workflows
Body: `{ "name": string, "description"?: string }`
201: `Workflow` — empty graph.

### PATCH /workflows/:id
Body: partial `Workflow` — used for save-draft.
200: `Workflow`.

### DELETE /workflows/:id
204.

### POST /workflows/:id/validate
200: `{ "ok": boolean, "errors": Array<{ nodeId: string, field?: string, message: string }> }`
Server re-runs the same zod schemas defined in `src/lib/nodeSchemas.ts`
(the frontend validates for immediate feedback; the server is authoritative).

### POST /workflows/:id/compile
200: `{ "config": string }` — generated `nginx.conf`. Server uses the same
generator logic as `src/lib/nginxGenerator.ts`.

### GET /workflows/:id/versions
200: `Array<{ version: number, updatedAt: string, author: string, message?: string }>`.

### POST /workflows/:id/rollback
Body: `{ "toVersion": number }`
200: `Workflow` — snapshot restored as the new head version.

### Workflow shape
```json
{
  "id": "wf_edge_api",
  "name": "Public API Edge",
  "description": "...",
  "status": "deployed" | "drifted" | "failed" | "draft",
  "version": 7,
  "updatedAt": "2026-07-10T14:22:00Z",
  "domains": ["api.example.com"],
  "nodes": [WorkflowNode],
  "edges": [WorkflowEdge]
}
```

### WorkflowNode
```json
{
  "id": "n_abc123",
  "type": "Listener" | "Domain" | "SSL" | "Route" | "Auth" | "RateLimit"
        | "Cache" | "LB" | "Backend" | "GRPC" | "TCP" | "UDP",
  "label": "HTTPS :443",
  "x": 60, "y": 80,
  "properties": { /* free-form, validated per type — see nodeSchemas.ts */ }
}
```

### WorkflowEdge
```json
{ "id": "e_abc", "from": "<nodeId>", "to": "<nodeId>" }
```

Allowed edge topology is defined in `src/lib/nodeRules.ts` and must be
enforced server-side as well:

| From        | Allowed To                                                   |
| ----------- | ------------------------------------------------------------ |
| Listener    | Domain                                                       |
| Domain      | SSL, Route, Auth, RateLimit, Cache, LB, Backend, GRPC        |
| SSL         | *(terminal — only a target of Domain)*                       |
| Route       | Auth, RateLimit, Cache, LB, Backend, GRPC                    |
| Auth        | Route, LB, Backend, GRPC                                     |
| RateLimit   | Route, LB, Backend, GRPC                                     |
| Cache       | Route, LB, Backend, GRPC                                     |
| LB          | Backend, GRPC                                                |
| Backend     | *(terminal)*                                                 |
| GRPC        | *(terminal)*                                                 |
| TCP / UDP   | Backend                                                      |

---

## 3. Deployments

### GET /deployments
Query: `?workflowId=&status=&limit=&cursor=`
200: `Deployment[]`.

### POST /workflows/:id/deploy
Body: `{ "message"?: string }`
202: `Deployment` — status `in_progress`.

### POST /deployments/:id/rollback
202: `Deployment` — rollback job for that deployment.

### GET /deployments/:id
200: `Deployment` (with `logs?: string[]` when detailed).

### Deployment shape
```json
{
  "id": "d_1",
  "workflowId": "wf_edge_api",
  "workflowName": "Public API Edge",
  "version": 7,
  "status": "success" | "failed" | "rolled_back" | "in_progress",
  "author": "Alex Morgan",
  "timestamp": "2026-07-10T14:22:00Z",
  "durationMs": 3200
}
```

---

## 4. Certificates & Let's Encrypt

### GET /certificates
200: `Certificate[]`.

### POST /certificates/lets-encrypt
Body:
```json
{
  "domain": "api.example.com",
  "challenge": "http-01" | "dns-01",
  "dnsProvider": "cloudflare" | "route53" | "digitalocean" | "google" | "azure" | ...,
  "email": "ops@proxyforge.io"
}
```
202: `{ "jobId": string }` — ACME issuance is async.

### GET /certificates/lets-encrypt/:jobId
200: `{ "status": "pending" | "issued" | "error", "error"?: string, "certificateId"?: string }`

### POST /certificates
Body (manual PEM upload):
```json
{
  "domain": "api.example.com",
  "certPem": "-----BEGIN CERTIFICATE-----\n...",
  "keyPem":  "-----BEGIN PRIVATE KEY-----\n..."
}
```
201: `Certificate`. Server stores PEM encrypted; frontend never sees the file path.

### DELETE /certificates/:id
204.

### Certificate shape
```json
{
  "id": "c_1",
  "domain": "api.example.com",
  "issuer": "Let's Encrypt",
  "expiresAt": "2026-09-04T00:00:00Z",
  "status": "valid" | "expiring" | "expired"
}
```

---

## 5. Metrics & Logs

### GET /metrics/traffic
Query: `?range=1h|24h|7d|30d&workflowId=`
200: `MetricPoint[]`
```json
{ "time": "14:00", "requests": 4820, "errors": 22, "latencyMs": 68 }
```

### GET /metrics/stats
200:
```json
{
  "totalWorkflows": 5, "deployed": 3, "drifted": 1, "failed": 1,
  "totalDomains": 6, "expiringCerts": 1,
  "requestsPerSec": 4820, "errorRate": 0.42, "p95Latency": 68
}
```

### GET /metrics/nodes/:nodeId
Query: `?range=sec|min|hour|day|week|month&workflowId=`
Powers the workspace canvas "Live" per-node request counters. The workspace
polls this endpoint every 5 seconds for every node in the current workflow
while the Live toggle is on.
200:
```json
{
  "nodeId": "n_abc123",
  "range": "min",
  "count": 4820,
  "generatedAt": "2026-07-16T12:34:56Z",
  "series"?: [/* optional per-bucket samples for sparklines */]
}
```

### GET /logs
Query: `?workflowId=&level=&limit=&cursor=&from=&to=`
200: `Array<{ ts: string, level: "info"|"warn"|"error", workflowId?: string, message: string }>`

### GET /logs/stream (SSE, optional)
Server-Sent Events stream of the same log records.

---

## 6. Settings

### GET /settings
200: `{ theme, defaultProvider, notifications, ... }`

### PATCH /settings
Body: partial settings.
200: updated settings.

---

## 7. Frontend ↔ Backend mapping

| UI area                                | Endpoints used                                                     |
| -------------------------------------- | ------------------------------------------------------------------ |
| Login page                             | `POST /auth/login`, `GET /auth/me`                                 |
| Dashboard KPIs & graphs                | `GET /metrics/stats`, `GET /metrics/traffic`                       |
| Workspace list                         | `GET /workflows`                                                   |
| Workspace editor (canvas)              | `GET /workflows/:id`, `PATCH /workflows/:id`, `POST /validate`, `POST /compile` |
| Deploy button                          | `POST /workflows/:id/deploy`, poll `GET /deployments/:id`          |
| Versions dropdown                      | `GET /workflows/:id/versions`, `POST /rollback`                    |
| SSL node → "Generate certificate"      | `POST /certificates/lets-encrypt` → poll job                       |
| SSL node → manual PEM                  | `POST /certificates`                                               |
| Certificates page                      | `GET /certificates`, `DELETE /certificates/:id`                    |
| Deployments page                       | `GET /deployments`                                                 |
| Metrics page                           | `GET /metrics/traffic`                                             |
| Logs page                              | `GET /logs` (+ optional `/logs/stream`)                            |
| Settings page                          | `GET /settings`, `PATCH /settings`                                 |

---

## 8. Node property reference

Each `WorkflowNode.properties` object is validated per node type against
the schema in `src/lib/nodeSchemas.ts`. Every node also accepts the common
fields `extraHeaders` (list of `{name,value,always?}`) and `extraDirectives`
(free-form nginx string). Summary of the type-specific fields:

- **Listener** — `port` (1–65535), `protocol` (`http`/`https`), `http2`,
  `defaultServer`, `proxyProtocol`, `reuseport`.
- **Domain** — `hostnames: string[]` (RFC-1123 or wildcard), `redirectApex`.
- **SSL** — `leMode` (bool). If `false`: `certPem`, `keyPem`. If `true`:
  `leDomain`, `leChallenge` (`http-01`/`dns-01`), `leDnsProvider`,
  `leEmail`, plus runtime status `leStatus` / `leError`. Common:
  `protocols` (TLSv1.2/1.3), `ciphers`, `hsts`, `hstsMaxAge`.
- **Route** — `path`, `matchMode` (`prefix`/`exact`/`regex`/`regex-ci`/
  `preferential`), `stripPrefix`, `rewrite?`, `tryFiles?`.
- **Auth** — `type` (`none`/`basic`/`ip-allowlist`/`jwt`/`subrequest`) plus
  type-specific fields (users file, allow list, JWKS URL, subrequest URL).
- **RateLimit** — `zoneName`, `zoneSizeMb`, `rate` (e.g. `50r/s`), `burst`,
  `nodelay`, `key` (default `$binary_remote_addr`).
- **Cache** — `zoneName`, `zoneSizeMb`, `inactive`, `validCodes`, `key`,
  `bypass`, `useStale[]`.
- **LB** — `algorithm` (`round-robin`/`least_conn`/`ip_hash`/`hash`),
  `hashKey?`, `keepalive`.
- **Backend** — `address`, `port`, `weight`, `maxFails`, `failTimeout`,
  `backup`, `healthCheck` (+ `path`, `interval`), `proxyHeaders`,
  `readTimeout`, `connectTimeout`.
- **GRPC** — `address`, `port`, `tls` (grpc vs grpcs), `connectTimeout`,
  `readTimeout`, `sendTimeout`, `grpcHeaders`.
- **TCP** — `port`, `proxyPass`, `proxyTimeout`, `proxyConnectTimeout`.
- **UDP** — `port`, `proxyPass`, `proxyResponses`, `proxyTimeout`.

---

## 9. Change log

Update this section whenever the UI adds/changes an endpoint contract.

- 2026-07-15 — initial draft. Covers auth, workflows, deployments,
  certificates (incl. Let's Encrypt), metrics, logs, settings. Added
  GRPC, TCP, UDP node types.
