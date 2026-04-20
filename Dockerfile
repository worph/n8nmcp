# syntax=docker/dockerfile:1.6

# --- stage 1: build the wrapper ---
FROM node:20-alpine AS build
WORKDIR /wrapper
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm run build && pnpm prune --prod

# --- stage 2: final image layered on the upstream n8n-mcp ---
FROM ghcr.io/czlonkowski/n8n-mcp:latest

USER root
RUN apk add --no-cache supervisor curl

# Wrapper lives at /wrapper so /app stays owned by the upstream as-shipped.
WORKDIR /wrapper
COPY --from=build /wrapper/dist ./dist
COPY --from=build /wrapper/node_modules ./node_modules
COPY --from=build /wrapper/package.json ./package.json
COPY web/ ./web/

# Wrapper state lives under /app/wrapper-data (persisted via volume).
# Do NOT use /app/data — the upstream image ships nodes.db there.
RUN mkdir -p /app/wrapper-data /var/log /var/run \
 && touch /app/upstream.env \
 && chmod 600 /app/upstream.env

COPY supervisord.conf /etc/supervisord.conf

ENV PORT=9640 \
    UPSTREAM_PORT=3000 \
    DISCOVERY_PORT=9099 \
    CONFIG_PATH=/app/wrapper-data/config.json \
    UPSTREAM_ENV_PATH=/app/upstream.env

EXPOSE 9640 9099/udp

# Override the upstream image's entrypoint — supervisord is now PID 1.
ENTRYPOINT []
CMD ["supervisord", "-c", "/etc/supervisord.conf"]
