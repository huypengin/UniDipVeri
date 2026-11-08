# ==============================================================================
# Multi-Stage Production Dockerfile for UniDipVeri Public Showcase on Render
# Uses official Walt.id Verifier 2 (Ubuntu + Java 21) as base image,
# and copies Bun and Caddy binaries directly.
# ==============================================================================

# Stage 1: Caddy Static Binary
FROM docker.io/caddy:2.8-alpine AS caddy-src

# Stage 2: Bun Static Binary (Bun 1.x matching lockfile v2)
FROM docker.io/oven/bun:1 AS bun-src

# Stage 3: Unified Production Runtime (Walt.id Verifier 2 Base)
FROM docker.io/waltid/verifier-api2:1.2.0@sha256:2e8581019531c2efa17a2c086b9c76ee7fee4bb5ee68369e2ea1864733039e9a AS final

USER root

# Install curl, ca-certificates, and libcap2-bin (for removing setcap from Caddy on Render)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        libcap2-bin && \
    rm -rf /var/lib/apt/lists/*

# Install Caddy reverse proxy gateway binary into system PATH and strip setcap file capabilities
# (Render security sandbox forbids executing binaries with setcap file capabilities, throwing EPERM)
COPY --from=caddy-src /usr/bin/caddy /usr/local/bin/caddy
RUN chmod 755 /usr/local/bin/caddy && setcap -r /usr/local/bin/caddy

# Install Bun runtime binary into system PATH
COPY --from=bun-src /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /unidipveri

# Copy dependency manifests for efficient Docker layer caching
COPY package.json bun.lock tsconfig.json ./
COPY packages/core/package.json ./packages/core/
COPY apps/issuer/package.json ./apps/issuer/
COPY apps/playground/package.json ./apps/playground/

# Install workspace dependencies with frozen lockfile
RUN bun install --frozen-lockfile

# Copy application sources, schemas, scripts, and deployment configuration
COPY packages/core ./packages/core
COPY apps/issuer ./apps/issuer
COPY apps/playground ./apps/playground
COPY schemas ./schemas
COPY scripts ./scripts
COPY deploy ./deploy

# Ensure entrypoint script is executable
RUN chmod +x /unidipveri/deploy/entrypoint.sh

# Production environment defaults
ENV NODE_ENV=production
ENV PORT=10000

# Expose only the primary public gateway port (Render default port)
EXPOSE 10000

ENTRYPOINT ["/unidipveri/deploy/entrypoint.sh"]
