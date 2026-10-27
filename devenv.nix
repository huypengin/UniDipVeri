{ pkgs, ... }:

{
  languages.javascript = {
    enable = true;
    bun.enable = true;
  };

  packages = [
    pkgs.cloudflared
    pkgs.curl
  ];

  processes = {
    issuer-tunnel = {
      exec = ''
        mkdir -p .devenv
        rm -f .devenv/issuer-tunnel.log
        echo "Starting Cloudflare Quick Tunnel on port 3000..."
        cloudflared tunnel --url http://localhost:3000 2>&1 | tee .devenv/issuer-tunnel.log
      '';
    };

    issuer = {
      exec = ''
        mkdir -p .devenv
        export LOGS_DIR="''${LOGS_DIR:-$DEVENV_ROOT/logs}"
        export LOG_DIR="''$LOGS_DIR"
        export LOG_FILE="''${LOG_FILE:-$LOGS_DIR/issuer.log}"
        mkdir -p "''$LOGS_DIR"

        if [ -n "''${ISSUER_BASE_URL:-}" ]; then
          echo "Using preconfigured ISSUER_BASE_URL: ''$ISSUER_BASE_URL"
        else
          echo "Waiting for Issuer Cloudflare Tunnel public URL to be assigned..."
          for i in {1..60}; do
            if [ -f .devenv/issuer-tunnel.log ] && grep -o 'https://[-a-zA-Z0-9.]*\.trycloudflare\.com' .devenv/issuer-tunnel.log >/dev/null 2>&1; then
              TUNNEL_URL=$(grep -o 'https://[-a-zA-Z0-9.]*\.trycloudflare\.com' .devenv/issuer-tunnel.log | head -n 1)
              break
            fi
            sleep 0.5
          done

          if [ -z "''${TUNNEL_URL:-}" ]; then
            echo "Warning: Cloudflare tunnel URL not detected after 30s. Falling back to http://localhost:3000."
            TUNNEL_URL="http://localhost:3000"
            DOMAIN="localhost%3A3000"
          else
            DOMAIN=$(echo "''$TUNNEL_URL" | sed -e 's|^https://||' -e 's|/.*$||')
          fi

          export ISSUER_BASE_URL="''$TUNNEL_URL"
          export VCT_BASE_URL="''$TUNNEL_URL"
          export ISSUER_DID="did:web:''$DOMAIN"
        fi

        export SCHEMA_PATH="''${SCHEMA_PATH:-$DEVENV_ROOT/schemas/graduation-record.v1.yaml}"
        export PORT="''${PORT:-3000}"
        export ENABLE_LEGACY_VC_FORMAT="''${ENABLE_LEGACY_VC_FORMAT:-false}"

        echo "=========================================================="
        echo " UniDipVeri Issuer running via devenv process manager"
        echo " Base URL:    ''$ISSUER_BASE_URL"
        echo " Issuer DID:  ''$ISSUER_DID"
        echo " Logs Dir:    ''$LOGS_DIR"
        echo " Portal:      ''$ISSUER_BASE_URL"
        echo " Swagger:     ''$ISSUER_BASE_URL/docs"
        echo " Discovery:   ''$ISSUER_BASE_URL/.well-known/openid-credential-issuer"
        echo " DID Doc:     ''$ISSUER_BASE_URL/.well-known/did.json"
        echo "=========================================================="

        bun run dev:issuer
      '';
    };

    verifier = {
      exec = ''
        COMPOSE_CLI=$(command -v podman-compose 2>/dev/null || command -v docker-compose 2>/dev/null || echo "docker compose")
        echo "Starting Walt.id Verifier via ''$COMPOSE_CLI..."

        cleanup() {
          echo "Stopping Walt.id verifier container via compose..."
          ''$COMPOSE_CLI down -v --remove-orphans >/dev/null 2>&1 || true
          podman rm -f $(podman ps -aq --filter "name=waltid-verifier") >/dev/null 2>&1 || true
          docker rm -f $(docker ps -aq --filter "name=waltid-verifier") >/dev/null 2>&1 || true
        }
        trap cleanup EXIT INT TERM

        # Pre-flight cleanup: remove any stale containers from previous runs or crashes
        ''$COMPOSE_CLI down -v --remove-orphans >/dev/null 2>&1 || true
        podman rm -f $(podman ps -aq --filter "name=waltid-verifier") >/dev/null 2>&1 || true
        docker rm -f $(docker ps -aq --filter "name=waltid-verifier") >/dev/null 2>&1 || true

        ''$COMPOSE_CLI up --force-recreate
      '';
    };

    verifier-tunnel = {
      exec = ''
        mkdir -p .devenv
        rm -f .devenv/verifier-tunnel.log
        echo "Starting Cloudflare Quick Tunnel for Walt.id Verifier on port 7004..."
        cloudflared tunnel --url http://localhost:7004 2>&1 | tee .devenv/verifier-tunnel.log
      '';
    };

    playground = {
      exec = ''
        mkdir -p .devenv
        export LOGS_DIR="''${LOGS_DIR:-$DEVENV_ROOT/logs}"
        export LOG_DIR="''$LOGS_DIR"
        mkdir -p "''$LOGS_DIR"

        if [ -z "''${ISSUER_BASE_URL:-}" ]; then
          for i in {1..60}; do
            if [ -f .devenv/issuer-tunnel.log ] && grep -o 'https://[-a-zA-Z0-9.]*\.trycloudflare\.com' .devenv/issuer-tunnel.log >/dev/null 2>&1; then
              export ISSUER_BASE_URL=$(grep -o 'https://[-a-zA-Z0-9.]*\.trycloudflare\.com' .devenv/issuer-tunnel.log | head -n 1)
              break
            fi
            sleep 0.5
          done
        fi

        echo "Waiting for Verifier Cloudflare Tunnel public URL to be assigned..."
        for i in {1..60}; do
          if [ -f .devenv/verifier-tunnel.log ] && grep -o 'https://[-a-zA-Z0-9.]*\.trycloudflare\.com' .devenv/verifier-tunnel.log >/dev/null 2>&1; then
            VERIFIER_PUBLIC_URL=$(grep -o 'https://[-a-zA-Z0-9.]*\.trycloudflare\.com' .devenv/verifier-tunnel.log | head -n 1)
            break
          fi
          sleep 0.5
        done

        if [ -z "''${VERIFIER_PUBLIC_URL:-}" ]; then
          echo "Notice: Verifier tunnel not detected, using http://localhost:7004"
          export VERIFIER_PUBLIC_URL="http://localhost:7004"
        else
          export VERIFIER_PUBLIC_URL="''$VERIFIER_PUBLIC_URL"
        fi

        export PORT="''${PORT:-3001}"
        export VCT_TYPE="''${VCT_TYPE:-graduation-record}"
        export VCT_VERSION="''${VCT_VERSION:-v1}"

        echo "Waiting for Walt.id Verifier readiness on http://localhost:7004..."
        for i in {1..40}; do
          STATUS=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:7004/ 2>/dev/null || true)
          if [ "''$STATUS" = "302" ] || [ "''$STATUS" = "200" ]; then
            echo "✓ Walt.id Verifier is ready"
            break
          fi
          sleep 1
        done

        echo "=========================================================="
        echo " UniDipVeri Playground Showcase running"
        echo " UI:                        http://localhost:''$PORT"
        echo " VCT Type:                  ''$VCT_TYPE"
        echo " VCT Version:               ''$VCT_VERSION"
        echo " Issuer Public:             ''$ISSUER_BASE_URL"
        echo " Verifier Engine Public:    ''$VERIFIER_PUBLIC_URL"
        echo " Logs Dir:                  ''$LOGS_DIR"
        echo "=========================================================="

        bun run dev:playground
      '';
    };
  };
}
