#!/bin/sh
# ProxyForge container entrypoint.
#
# Starts the UI/SSR server as a supervised background process, then execs
# the API server as PID 1. The API server (src/nginx/processManager.ts)
# owns the real nginx binary as its own child process from there —
# starting it, validating every generated config with `nginx -t` before
# reloading, and restarting it if it exits. See Section 16.2 of the design
# doc for the reasoning.
set -e

mkdir -p "$DATA_DIR/nginx/conf.d/http" "$DATA_DIR/nginx/conf.d/stream" \
         "$DATA_DIR/certs/managed" "$DATA_DIR/backups" "$DATA_DIR/logs" \
         "$DATA_DIR/db" "$DATA_DIR/acme-webroot" "$DATA_DIR/dns-credentials"

# Supervise the UI server with a simple restart loop — it's a small,
# stateless SSR/static server, so "just restart it" is a reasonable policy.
(
  while true; do
    node /app/frontend/serve.mjs || echo "[entrypoint] UI server exited, restarting in 2s"
    sleep 2
  done
) &

exec node /app/backend/dist/index.js
