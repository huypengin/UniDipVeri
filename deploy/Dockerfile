# ==============================================================================
# Multi-Stage Production Dockerfile for UniDipVeri Public Showcase on Render
# Combines UniDipVeri Issuer, Verifier Showcase, Caddy Gateway, and Walt.id Verifier 2
# ==============================================================================

# Stage 1: Walt.id Verifier 2 binary & libraries
FROM docker.io/waltid/verifier-api2:1.2.0@sha256:2e8581019531c2efa17a2c086b9c76ee7fee4bb5ee68369e2ea1864733039e9a AS waltid-src

# Stage 2: Caddy Web Server Binary
FROM docker.io/caddy:2.8-alpine AS caddy-src

# Stage 3: Unified Production Runtime (Debian + Bun 1.x)
FROM oven/bun:1.2-slim AS final

# Install OpenJDK 21 headless (required by Walt.id Kotlin/JVM app), curl, ca-certificates, and bash
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        openjdk-21-jre-headless \
        curl \
        ca-certificates \
        bash && \
    rm -rf /var/lib/apt/lists/*

# Install Caddy reverse proxy gateway binary into system PATH
COPY --from=caddy-src /usr/bin/caddy /usr/local/bin/caddy

# Install Walt.id Verifier 2 application
COPY --from=waltid-src /app /opt/waltid
RUN chmod +x /opt/waltid/bin/verifier-api2

WORKDIR /app

# Copy dependency manifests for efficient Docker layer caching
COPY package.json bun.lock tsconfig.json ./
COPY packages/core/package.json ./packages/core/
COPY apps/issuer/package.json ./apps/issuer/
COPY apps/playground/package.json ./apps/playground/

# Install dependencies using frozen lockfile
RUN bun install --frozen-lockfile

# Copy application sources, schemas, scripts, and deployment configuration
COPY packages/core ./packages/core
COPY apps/issuer ./apps/issuer
COPY apps/playground ./apps/playground
COPY schemas ./schemas
COPY scripts ./scripts
COPY deploy ./deploy

# Ensure entrypoint script is executable
RUN chmod +x /app/deploy/entrypoint.sh

# Production environment defaults
ENV NODE_ENV=production
ENV PORT=8080

# Expose public gateway port (Render automatically maps external traffic here)
EXPOSE 8080 3000 3001 7004

ENTRYPOINT ["/app/deploy/entrypoint.sh"]
