#!/usr/bin/env bash
set -euo pipefail

# 1. Determine Public Hostname and URLs
GATEWAY_PORT="${PORT:-8080}"
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

# 3. Microservice Configuration
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
  kill "${WALTID_PID:-}" "${ISSUER_PID:-}" "${PLAYGROUND_PID:-}" 2>/dev/null || true
  exit 0
}
trap cleanup EXIT INT TERM

# 5. Launch Walt.id Verifier 2 via native Jib classpath
echo "Starting Walt.id Verifier 2 on internal port 7004..."
(cd /waltid-verifier-api2 && java -cp "@/app/jib-classpath-file" id.walt.verifier2.MainKt) &
WALTID_PID=$!

# 6. Launch UniDipVeri Issuer
echo "Starting UniDipVeri Issuer on internal port 3000..."
PORT=3000 bun run /unidipveri/apps/issuer/src/server.ts &
ISSUER_PID=$!

# 7. Launch UniDipVeri Playground Showcase
echo "Starting UniDipVeri Playground Showcase on internal port 3001..."
PORTAL_PORT=3001 PORT=3001 bun run /unidipveri/apps/playground/src/server.ts &
PLAYGROUND_PID=$!

# 8. Readiness Verification Loop
echo "Verifying readiness of internal services..."
for i in {1..30}; do
  ISSUER_OK=false
  PLAYGROUND_OK=false
  VERIFIER_OK=false

  if curl -s http://127.0.0.1:3000/health >/dev/null 2>&1; then ISSUER_OK=true; fi
  if curl -s http://127.0.0.1:3001/api/status >/dev/null 2>&1 || curl -s http://127.0.0.1:3001/ >/dev/null 2>&1; then PLAYGROUND_OK=true; fi
  if curl -s http://127.0.0.1:7004/livez >/dev/null 2>&1 || curl -s http://127.0.0.1:7004/health >/dev/null 2>&1; then VERIFIER_OK=true; fi

  if [ "$ISSUER_OK" = "true" ] && [ "$PLAYGROUND_OK" = "true" ] && [ "$VERIFIER_OK" = "true" ]; then
    echo "✓ All internal services are healthy and responsive."
    break
  fi
  sleep 1
done

# 9. Launch Caddy Gateway in Foreground
echo "=========================================================="
echo " UniDipVeri Production Demo Gateway starting on port ${GATEWAY_PORT}"
echo " Public Gateway:    ${PUBLIC_URL}"
echo " Showcase UI:       ${PUBLIC_URL}/playground"
echo " Registrar Portal:  ${PUBLIC_URL}/issuer"
echo " OID4VCI Metadata:  ${PUBLIC_URL}/issuer/.well-known/openid-credential-issuer"
echo " DID Document:      ${PUBLIC_URL}/issuer/did.json"
echo " Health Probe:      ${PUBLIC_URL}/health"
echo "=========================================================="

PORT="${GATEWAY_PORT}" exec caddy run --config /unidipveri/deploy/Caddyfile --adapter caddyfile
