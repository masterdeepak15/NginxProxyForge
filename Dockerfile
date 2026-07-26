# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────
# Stage 1 — build the frontend (React + TanStack Start, built with Bun)
# ─────────────────────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/bun.lock frontend/bunfig.toml ./
RUN bun install
COPY frontend/ ./
RUN bun run build
# Prune to production-only deps for the runtime image (serve.mjs only needs
# serve-static + finalhandler at runtime; the SSR bundle itself is
# self-contained, but we keep node_modules around as a safety net).
RUN bun install --production

# ─────────────────────────────────────────────────────────────────────────
# Stage 2 — build the backend (Node/Express/TypeScript, node:sqlite)
# ─────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS backend-build
WORKDIR /app/backend
COPY backend/package.json ./
RUN npm install --include=dev
COPY backend/ ./
RUN npm run build
RUN npm prune --omit=dev

# ─────────────────────────────────────────────────────────────────────────
# Stage 3 — final runtime image: Node + real nginx + certbot, nothing else
# ─────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS final

RUN apk add --no-cache nginx nginx-mod-stream certbot tzdata

WORKDIR /app

COPY --from=backend-build /app/backend/dist        ./backend/dist
COPY --from=backend-build /app/backend/node_modules ./backend/node_modules
COPY --from=backend-build /app/backend/package.json ./backend/package.json

COPY --from=frontend-build /app/frontend/dist         ./frontend/dist
COPY --from=frontend-build /app/frontend/node_modules ./frontend/node_modules
COPY --from=frontend-build /app/frontend/serve.mjs    ./frontend/serve.mjs
COPY --from=frontend-build /app/frontend/package.json ./frontend/package.json

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/www/welcome/ /usr/share/proxyforge/welcome/
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && \
    mkdir -p /data && \
    # nginx on Alpine wants a couple of dirs that don't exist until first run
    mkdir -p /var/lib/nginx/tmp /var/log/nginx

ENV DATA_DIR=/data \
    NGINX_MAIN_CONF=/etc/nginx/nginx.conf \
    NGINX_BIN=nginx \
    CERTBOT_BIN=certbot \
    PORT=3001 \
    UI_PORT=3000 \
    NODE_ENV=production

VOLUME ["/data"]
EXPOSE 80 443 81

ENTRYPOINT ["/app/entrypoint.sh"]
