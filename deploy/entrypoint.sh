#!/usr/bin/env bash
set -euo pipefail

# 1. Determine Public Hostname and URLs
GATEWAY_PORT="${PORT:-10000}"
PUBLIC_URL="${PUBLIC_URL:-${RENDER_EXTERNAL_URL:-http://localhost:${GATEWAY_PORT}}}"
PUBLIC_URL="${PUBLIC_URL%/}"
DOMAIN=$(echo "$PUBLIC_URL" | sed -e 's|^https://||' -e 's|^http://||' -e 's|/.*$||')

# Allow local loopback testing if URL is localhost / 127.0.0.1
if [[ "$PUBLIC_URL" =~ ^http://(localhost|127\.0\.0\.1) ]]; then
  export NODE_ENV=development
fi

# 2. Key Custody and Persistent Identity
if [ -z "${ISSUER_PRIVATE_KEY_JWK:-}" ]; then
  echo "⚠️ WARNING: ISSUER_PRIVATE_KEY_JWK is not configured in environment settings."
  echo "⚠️ Generating ephemeral signing keys for this session."
  echo "⚠️ Note: In the demo environment without persistent keys, credentials issued"
  echo "⚠️ in previous sessions cannot be verified after server spin-downs or restarts."
  export ISSUER_PRIVATE_KEY_JWK=$(bun run /unidipveri/scripts/generate-key.ts --json)
else
  echo "✓ Loaded persistent demo signing key from environment settings."
fi

# 3. Microservice Configuration (Internal services bind strictly to 127.0.0.1)
export BIND_HOST="127.0.0.1"
export ISSUER_BASE_URL="${PUBLIC_URL}/issuer"
export VCT_BASE_URL="${PUBLIC_URL}/issuer"
export ISSUER_DID="did:web:${DOMAIN}:issuer"
export SCHEMA_PATH="/unidipveri/schemas/graduation-record.v1.yaml"
export STATUS_LIST_PATH="${STATUS_LIST_PATH:-/tmp/status-list.json}"

export WALTID_BASE="http://127.0.0.1:7004"
export VERIFIER_PUBLIC_URL="${PUBLIC_URL}/verifier"

# 4. Graceful Cleanup Trap
cleanup() {
  echo "Terminating internal background microservices..."
  kill "${CADDY_PID:-}" "${WALTID_PID:-}" "${ISSUER_PID:-}" "${PLAYGROUND_PID:-}" 2>/dev/null || true
  exit 0
}
trap cleanup EXIT INT TERM

# 5. Launch Caddy Gateway FIRST on $GATEWAY_PORT
# Starting Caddy immediately ensures Render detects the public gateway port ($PORT/10000)
# from second 0 and does not attempt to bind external traffic to internal microservice ports.
echo "=========================================================="
echo " UniDipVeri Production Demo Gateway starting on port ${GATEWAY_PORT}"
echo " Public Gateway:    ${PUBLIC_URL}"
echo " Showcase UI:       ${PUBLIC_URL}/playground"
echo " Registrar Portal:  ${PUBLIC_URL}/issuer"
echo " OID4VCI Metadata:  ${PUBLIC_URL}/issuer/.well-known/openid-credential-issuer"
echo " DID Document:      ${PUBLIC_URL}/issuer/did.json"
echo " Health Probe:      ${PUBLIC_URL}/health"
echo "=========================================================="
PORT="${GATEWAY_PORT}" caddy run --config /unidipveri/deploy/Caddyfile --adapter caddyfile &
CADDY_PID=$!

# 6. Launch Walt.id Verifier 2 via native Jib classpath
echo "Starting Walt.id Verifier 2 on internal port 7004..."
(cd /waltid-verifier-api2 && java -cp "@/app/jib-classpath-file" id.walt.verifier2.MainKt) &
WALTID_PID=$!

# 7. Launch UniDipVeri Issuer (binds to 127.0.0.1:3000)
echo "Starting UniDipVeri Issuer on internal port 3000..."
PORT=3000 bun run /unidipveri/apps/issuer/src/server.ts &
ISSUER_PID=$!

# 8. Launch UniDipVeri Playground Showcase (binds to 127.0.0.1:3001)
echo "Starting UniDipVeri Playground Showcase on internal port 3001..."
PORTAL_PORT=3001 PORT=3001 bun run /unidipveri/apps/playground/src/server.ts &
PLAYGROUND_PID=$!

# 9. Readiness Verification Loop (up to 90s for Walt.id JVM warm-up on cold starts)
echo "Verifying readiness of internal services..."
ALL_READY=false
for i in {1..90}; do
  ISSUER_OK=false
  PLAYGROUND_OK=false
  VERIFIER_OK=false

  if curl -s http://127.0.0.1:3000/health >/dev/null 2>&1; then ISSUER_OK=true; fi
  if curl -s http://127.0.0.1:3001/api/status >/dev/null 2>&1 || curl -s http://127.0.0.1:3001/ >/dev/null 2>&1; then PLAYGROUND_OK=true; fi
  if curl -s http://127.0.0.1:7004/livez >/dev/null 2>&1 || curl -s http://127.0.0.1:7004/health >/dev/null 2>&1; then VERIFIER_OK=true; fi

  if [ "$ISSUER_OK" = "true" ] && [ "$PLAYGROUND_OK" = "true" ] && [ "$VERIFIER_OK" = "true" ]; then
    echo "✓ All internal services are healthy and responsive (elapsed: ${i}s)."
    ALL_READY=true
    break
  fi
  sleep 1
done

if [ "$ALL_READY" != "true" ]; then
  echo "❌ FATAL: Internal microservices failed to become ready within 90s:"
  echo "  - UniDipVeri Issuer (port 3000):     ${ISSUER_OK}"
  echo "  - Playground Showcase (port 3001):   ${PLAYGROUND_OK}"
  echo "  - Walt.id Verifier 2 (port 7004):    ${VERIFIER_OK}"
  exit 1
fi

echo "✓ Production Gateway and all microservices are operational."
# Wait on supervised microservices; if any process exits unexpectedly, trigger cleanup
wait -n "${CADDY_PID}" "${WALTID_PID}" "${ISSUER_PID}" "${PLAYGROUND_PID}"
