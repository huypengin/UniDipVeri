#!/bin/sh
set -e

SHARED_DIR="/shared"
LOG_FILE="${SHARED_DIR}/cloudflared.log"
ENV_FILE="${SHARED_DIR}/tunnel.env"
TMP_ENV="${SHARED_DIR}/tunnel.env.tmp"
TIMEOUT_SECS=30
ELAPSED=0

# Clean up any stale files from previous runs
rm -f "$ENV_FILE" "$TMP_ENV" "$LOG_FILE"
mkdir -p "$SHARED_DIR"

echo "[Tunnel] Starting Cloudflare Quick Tunnel targeting http://caddy:8080..."
cloudflared tunnel --no-autoupdate --logfile "$LOG_FILE" --url http://caddy:8080 &
TUNNEL_PID=$!

trap "kill $TUNNEL_PID 2>/dev/null || true; exit 0" INT TERM

echo "[Tunnel] Waiting up to ${TIMEOUT_SECS}s for public hostname..."
while [ "$ELAPSED" -lt "$TIMEOUT_SECS" ]; do
  if [ -f "$LOG_FILE" ]; then
    # Extract URL candidate matching the Quick Tunnel format
    CANDIDATE=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$LOG_FILE" 2>/dev/null | head -n 1 || true)

    # Validate that extracted candidate is non-empty and well-formed
    if [ -n "$CANDIDATE" ] && echo "$CANDIDATE" | grep -qE '^https://[a-zA-Z0-9-]+\.trycloudflare\.com$'; then
      DOMAIN=$(echo "$CANDIDATE" | sed -e 's|^https://||')

      # Write environment file atomically via temp file
      cat <<EOF > "$TMP_ENV"
export PUBLIC_URL="${CANDIDATE}"
export ISSUER_BASE_URL="${CANDIDATE}/issuer"
export VCT_BASE_URL="${CANDIDATE}/issuer"
export ISSUER_DID="did:web:${DOMAIN}:issuer"
export VERIFIER_PUBLIC_URL="${CANDIDATE}/verifier"
EOF
      mv "$TMP_ENV" "$ENV_FILE"
      echo "[Tunnel] Public URL established and validated: ${CANDIDATE}"

      # Keep running in foreground
      wait "$TUNNEL_PID"
      exit 0
    fi
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

echo "[Tunnel] Error: Failed to acquire valid Quick Tunnel URL within ${TIMEOUT_SECS}s."
kill "$TUNNEL_PID" 2>/dev/null || true
exit 1
