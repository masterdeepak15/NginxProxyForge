# ProxyForge

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Visual, node-based control plane for Nginx. Design reverse-proxy infrastructure
as a graph (Listener -> Domain -> SSL -> Route -> Auth/RateLimit/Cache -> LB ->
Backend), and ProxyForge compiles it to real, validated `nginx.conf` fragments,
deploys them with `nginx -t` + graceful reload + automatic rollback, and gives
you a dashboard for deployments, certificates, metrics, and logs.

Ships as a **single Docker image** containing the UI, the API, and the real
`nginx` binary - no external database, no separate services.

## Repository layout (umbrella)

```
NginxProxyForge/
+-- frontend/           React + TanStack Start (SSR) - the visual editor & dashboard
+-- backend/             Node.js + Express + TypeScript API - the actual control plane
+-- docker/              Container-only config (nginx.conf, entrypoint.sh)
+-- .github/workflows/   CI: builds & publishes the release Docker image
+-- Dockerfile            Single multi-stage build for the whole app
+-- docker-compose.yml    One service, one bind-mounted data folder
+-- API.md                Full REST API reference (source of truth for both sides)
```

## Architecture

- **`backend`** is PID 1 in the container. It owns the real `nginx` process
  (start / validate / reload / restart-on-crash - see
  `backend/src/nginx/processManager.ts`), runs the deploy pipeline
  (generate -> `nginx -t` -> backup -> reload -> health-check -> auto-rollback -
  see `backend/src/nginx/deployPipeline.ts`), and serves the REST API on an
  internal port (`:3001`).
- **`frontend`** is a separate small Node process (`frontend/serve.mjs`)
  serving the built TanStack Start SSR bundle + static assets on `:3000`.
- The container's own `nginx` (started by the backend) reverse-proxies the
  admin dashboard port `:81` to both of the above (`/api/*` -> backend,
  `/*` -> frontend), and serves real proxied traffic on `:80`/`:443` from the
  config the Config Generator writes to `/data/nginx/conf.d/**`.
- `/data` is the single bind-mounted volume holding everything persistent:
  SQLite DB, generated nginx fragments, certs, config backups, and per-listener
  access/error logs.

## Quick start (Docker Compose)

```bash
git clone https://github.com/masterdeepak15/NginxProxyForge.git
cd NginxProxyForge
docker compose up -d --build
docker compose logs -f proxyforge   # confirm the first-boot admin account
```

Then open `http://<host>:81`.

- `80` / `443` - real proxied traffic (only live once you deploy a workflow).
- `81` - the ProxyForge dashboard (same port convention as Nginx Proxy Manager).

All persistent state lives under `./data` next to `docker-compose.yml`. Deleting
the container never loses anything; only deleting `./data` does.

### First-boot credentials

If no admin user exists yet, one is created automatically on first start.
It uses a **fixed default** (the same pattern Nginx Proxy Manager uses),
and is forced to change its password on first login:

```
================================================================
 ProxyForge - first boot admin account created
 Email:    admin@proxyforge.local
 Password: changeme
 You will be required to change this password on first login.
================================================================
```

⚠️ **This default is publicly known** (it's in this README). It's fine for
a local/throwaway instance, but before exposing port `81` beyond
`localhost`, set a real `ADMIN_EMAIL` / `ADMIN_INITIAL_PASSWORD` in
`docker-compose.yml` so the account is never created with `changeme` in the
first place — don't rely on getting to the change-password prompt before
anything else finds the instance. Also change `JWT_SECRET` to a long random
string.

## Deployment process (what "Deploy" actually does)

1. **Generate** - the current workflow graph is compiled into Nginx
   `server{}` / `upstream{}` fragments (`backend/src/lib/nginxGenerator.ts` -
   ported 1:1 from the frontend's live preview, so what you see in
   "View nginx.conf" is what gets deployed).
2. **Validate** - the fragment is staged into `/data/nginx/conf.d/{http,stream}`
   and the whole tree is checked with `nginx -t`. On failure, the swap is
   rolled back and nothing reaches the live server.
3. **Backup** - the current `conf.d` is snapshotted to `/data/backups/<timestamp>`.
4. **Reload** - `nginx -s reload` (graceful, no dropped connections).
5. **Health check** - a TCP probe against the workflow's listener port.
6. **Rollback** - if the health check fails, the pre-deploy backup is restored
   and reloaded automatically; the deployment is recorded as `rolled_back`.

Every step is recorded to the `deployments` table and streamed to the
workflow's log tail. Every save also snapshots a `versions` row, so any prior
version can be restored from the editor's **Versions** panel.

## Local development (without Docker)

Requires Node.js >= 22.5 (for the built-in `node:sqlite` module used by the
backend - no native compilation, no `better-sqlite3`) and Bun for the frontend.

```bash
# backend - API on :3001
cd backend
npm install
npm run dev            # tsx watch, DATA_DIR defaults to ./data if unset

# frontend - Vite dev server on :8080 (separate terminal)
cd frontend
bun install
bun run dev
```

Point the frontend at the local API by creating `frontend/.env`:

```
VITE_API_BASE_URL=http://localhost:3001/api
```

In production (inside the container) the frontend talks to `/api` on the
same origin, which the container's nginx proxies to the backend - no env var
needed there.

Nginx itself won't start locally unless the `nginx` binary is on `PATH` (not
required for API/UI development - only for actually deploying a workflow,
which needs the real container).

## Releasing the Docker image

`.github/workflows/docker-release.yml` is the **single** CI workflow in this
repo. It builds the image once from the root `Dockerfile` and pushes it to
both registries on every `vX.Y.Z` tag push (or manually via "Run workflow"):

- `ghcr.io/masterdeepak15/nginxproxyforge`
- `masterdeepak15/nginxproxyforge` (Docker Hub) — requires the
  `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` repo secrets to be set

Once published, point `docker-compose.yml` at either registry image instead
of building locally:

```yaml
services:
  proxyforge:
    image: masterdeepak15/nginxproxyforge:latest   # or ghcr.io/masterdeepak15/nginxproxyforge:latest
    # remove the build: block
```

```bash
git tag v1.0.0
git push origin v1.0.0
```

## API

`API.md` at the repo root is the full REST contract (auth, workflows,
deployments, certificates, metrics, logs, settings). `frontend/src/services/api.ts`
and `backend/src/routes/*` both implement it - that file is the source of
truth if the two ever drift.

## Security notes

- Rotate `JWT_SECRET` and set a fixed `ADMIN_INITIAL_PASSWORD` before exposing
  port `81` beyond localhost.
- The GitHub PAT used to push this repository during setup should be
  rotated/revoked once you've confirmed the push succeeded - treat any token
  that's been pasted into a chat as compromised.
- Let's Encrypt HTTP-01 challenges are always answered on `:80` regardless of
  workflow state (see the default server in `docker/nginx.conf`), so
  certificate issuance works even before a domain's own workflow is deployed.
  DNS-01 requires the relevant `certbot-dns-*` plugin installed in the image
  and credentials mounted under `./data/dns-credentials/`.

## Known limitations (v1)

- Single admin tier - no RBAC/multi-tenant orgs (matches the Nginx Proxy
  Manager model this project follows).
- Metrics/traffic charts are derived from real nginx access logs written per
  listener (`/data/logs/<workflow>_<listener>.{access,error}.log`); latency
  percentiles aren't computed yet (nginx's default log format doesn't carry
  `$request_time` - add it to a custom `log_format` if you need it).
- DNS-01 ACME challenge support depends on which `certbot-dns-*` plugins you
  add to the image; only the HTTP-01 path is installed by default.

## License

MIT - see [LICENSE](./LICENSE). Free to self-host, modify, and redistribute.
