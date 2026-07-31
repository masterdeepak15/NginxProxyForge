# Security Audit — NginxProxyForge

Date: 2026-07-31
Scope: `backend/src` (Express API, auth, nginx process management, certbot) and
`frontend/src` (React SPA, token storage). Manual code review, no automated
scanner run.

Severity key: 🔴 High · 🟠 Medium · 🟡 Low / hardening

---

## Findings

### 🔴 Logout didn't actually revoke tokens — **fixed in this pass**

`middleware/auth.ts` maintained an in-memory `revoked` set and `/auth/logout`
called `revokeToken(token)`, but `requireAuth` never checked `isRevoked()`.
A "logged out" JWT stayed valid for the rest of its 12h lifetime — anyone who
captured a token (shared machine, XSS, leaked log) kept access after the
legitimate user logged out.

**Fix applied:** `requireAuth` now rejects any token present in the revoked
set before verifying it. No API/behavior change for callers.

**Residual limitation:** the revoked set is in-memory and per-process. It
resets on restart and won't be shared across horizontally scaled instances.
Fine for the current single-container deployment model; revisit (Redis-backed
blocklist, or move to short-lived access tokens + refresh tokens) if
ProxyForge ever runs as more than one replica.

### 🔴 No role-based access control despite having roles

`User.role` is `admin | operator | viewer` and the JWT carries `role`, but
`req.userRole` is set and then never read anywhere in any route. A `viewer`
account can deploy, delete workflows, rotate certificates, and change
settings — identical permissions to `admin`. The role field is currently
decorative.

**Recommendation:** add a `requireRole(...)` middleware and apply it to
write routes (deploy, delete, settings, certificates), keeping `viewer` as
genuinely read-only.

### 🟠 No rate limiting on `/auth/login`

`POST /auth/login` has no throttling, lockout, or backoff. It's brute-forceable
at whatever rate the network allows. `bcrypt.compareSync` costs some CPU per
attempt but that's not a substitute for rate limiting.

**Recommendation:** add `express-rate-limit` (or similar) scoped to
`/auth/login` — e.g. 10 attempts / 5 minutes per IP — and consider a
temporary account lockout after repeated failures.

### 🟠 Insecure default JWT secret

```ts
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";
```

If `JWT_SECRET` is never set (easy to miss when following the
`.env.example` quickly), every deployment shares the same well-known secret,
and anyone can forge valid tokens for any user/role.

**Recommendation:** fail fast at boot if `JWT_SECRET` is unset or equals the
placeholder value, rather than silently falling back to it.

### 🟠 JWT stored in `localStorage`

`frontend/src/services/api.ts` and `store/slices/authSlice.ts` persist the
auth token in `localStorage`. Any successful XSS anywhere in the app gets
trivial token exfiltration (no `HttpOnly` protection, unlike a cookie-based
session).

**Recommendation:** if/when the API and frontend share an origin behind the
same nginx (which they already do in this deployment model), moving to an
`HttpOnly`, `SameSite=Strict` session cookie removes this class of risk
entirely. This is a bigger structural change — worth planning, not a quick
patch.

### 🟡 Open CORS (`app.use(cors())`)

CORS is wide open with no origin allow-list. Low risk today because the
container's own nginx is the only thing meant to reach the API (see
`docker/nginx.conf`), but if the API port is ever exposed directly, this
allows any website to make requests against it.

**Recommendation:** restrict to the deployment's own origin via an env var
(`ALLOWED_ORIGIN`), default to same-origin only.

### 🟡 No security headers

No `helmet` (or manual equivalent) — no `X-Content-Type-Options`,
`X-Frame-Options` / `frame-ancestors`, `Referrer-Policy`, etc.

**Recommendation:** add `helmet()` with a CSP tuned for the SPA. Cheap,
low-risk win.

### 🟡 Global error handler echoes internal error messages

```ts
res.status(500).json({ error: { code: "internal_error", message: err?.message || "Internal error" } });
```

Fine for a self-hosted admin tool (the intended audience is the operator
themself), but if this is ever exposed more broadly, internal details in
`err.message` (e.g. raw SQLite errors) could leak schema or filesystem
paths. Consider logging the full error server-side and returning a generic
message to the client.

### 🟡 Container runs as root

The final Docker image has no `USER` directive — the Node process and
the nginx master both run as root inside the container. Necessary in part
because nginx needs to bind ports 80/443, but the Node/Express process
itself doesn't need root. Consider dropping privileges for the Node process
specifically, or granting `CAP_NET_BIND_SERVICE` instead of running
everything as root.

---

## What's already solid

- **SQL injection:** every query in `backend/src` uses prepared statements
  with bound parameters — no string-concatenated SQL found anywhere.
- **Command injection:** `certbot.ts` and `processManager.ts` invoke
  `spawn()`/`spawnSync()` with argument arrays, never `shell: true` or
  string-interpolated shell commands — domain names and other user input
  can't break out into shell metacharacters.
- **Password storage:** `bcryptjs` with a proper salt round (10), not a fast
  hash or reversible encryption.
- **File paths for certs/configs:** certificate and workflow-conf filenames
  are built from server-generated IDs (`randomUUID()`), not user-supplied
  strings — no path traversal surface found in `certificates.ts` or
  `processManager.ts`.
- **Config validation before deploy:** every generated nginx config runs
  through `nginx -t` before being swapped live, with automatic backup +
  restore + health-check + auto-rollback on failure (`deployPipeline.ts`).
  This is a strong safety net independent of the security issues above.

---

## Priority order for follow-up

1. ~~Logout doesn't revoke tokens~~ — done.
2. Add `requireRole` and apply to write endpoints (closes the biggest gap).
3. Rate-limit `/auth/login`.
4. Fail fast on missing/default `JWT_SECRET`.
5. `helmet()` + CORS allow-list.
6. Cookie-based sessions (bigger change, plan separately).
