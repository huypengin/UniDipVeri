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

  enterShell = ''
    rm -f .devenv/tunnel.url .devenv/tunnel.url.tmp .devenv/tunnel.log .devenv/tunnel.pending .devenv/*tunnel*.log
  '';

  services.caddy = {
    enable = true;
    config = builtins.readFile ./Caddyfile;
  };

  processes = {
    tunnel = {
      exec = ''
        mkdir -p .devenv
        touch .devenv/tunnel.pending
        rm -f .devenv/tunnel.url .devenv/tunnel.url.tmp .devenv/tunnel.log .devenv/*tunnel*.log

        cleanup() {
          echo "Stopping tunnel and wiping tunnel artifacts..."
          kill $TUNNEL_PID 2>/dev/null || true
          rm -f .devenv/tunnel.url .devenv/tunnel.url.tmp .devenv/tunnel.log .devenv/tunnel.pending .devenv/*tunnel*.log
          exit 0
        }
        trap cleanup EXIT INT TERM

        # Wait for Caddy to be listening on port 8080
        echo "Waiting for Caddy on port 8080..."
        for i in {1..30}; do
          if curl -s http://localhost:8080/health >/dev/null 2>&1; then
            echo "✓ Caddy is ready on port 8080"
            break
          fi
          sleep 1
        done

        # Launch cloudflared with native logfile (eliminates pipe block buffering)
        echo "Starting Cloudflare Quick Tunnel on Caddy port 8080..."
        cloudflared tunnel --no-autoupdate --logfile .devenv/tunnel.log --url http://localhost:8080 &
        TUNNEL_PID=$!

        # Detect, validate, and atomically publish URL to .devenv/tunnel.url
        for i in {1..60}; do
          if [ -f .devenv/tunnel.log ]; then
            URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' .devenv/tunnel.log | head -n 1 || true)
            if [ -n "$URL" ] && echo "$URL" | grep -qE '^https://[a-zA-Z0-9-]+\.trycloudflare\.com$'; then
              echo "$URL" > .devenv/tunnel.url.tmp
              mv .devenv/tunnel.url.tmp .devenv/tunnel.url
              rm -f .devenv/tunnel.pending
              echo "✓ Quick Tunnel ready and published: $URL"
              break
            fi
          fi
          sleep 1
        done

        wait $TUNNEL_PID
      '';
    };

    issuer = {
      exec = ''
        mkdir -p .devenv
        export LOGS_DIR="''${LOGS_DIR:-$DEVENV_ROOT/logs}"
        export LOG_DIR="''$LOGS_DIR"
        export LOG_FILE="''${LOG_FILE:-$LOGS_DIR/issuer.log}"
        mkdir -p "''$LOGS_DIR"

        cleanup() {
          rm -f .devenv/tunnel.url .devenv/tunnel.url.tmp .devenv/tunnel.log .devenv/tunnel.pending .devenv/*tunnel*.log
        }
        trap cleanup EXIT INT TERM

        if [ -n "''${ISSUER_BASE_URL:-}" ]; then
          echo "Using preconfigured ISSUER_BASE_URL: ''$ISSUER_BASE_URL"
        else
          echo "Waiting for Cloudflare Tunnel URL to be published..."
          for i in {1..60}; do
            if [ ! -f .devenv/tunnel.pending ] && [ -s .devenv/tunnel.url ]; then
              TUNNEL_URL=$(cat .devenv/tunnel.url | tr -d '[:space:]')
              break
            fi
            sleep 1
          done

          if [ -z "''${TUNNEL_URL:-}" ]; then
            echo "Warning: Cloudflare tunnel URL not detected after 30s. Falling back to http://localhost:8080."
            TUNNEL_URL="http://localhost:8080"
            DOMAIN="localhost%3A8080"
          else
            DOMAIN=$(echo "''$TUNNEL_URL" | sed -e 's|^https://||' -e 's|/.*$||')
          fi

          export ISSUER_BASE_URL="''$TUNNEL_URL/issuer"
          export VCT_BASE_URL="''$TUNNEL_URL/issuer"
          export ISSUER_DID="did:web:''$DOMAIN:issuer"
        fi

        export SCHEMA_PATH="''${SCHEMA_PATH:-$DEVENV_ROOT/schemas/graduation-record.v1.yaml}"
        export PORT="''${PORT:-3000}"
        export STATUS_LIST_TTL_SECONDS="''${STATUS_LIST_TTL_SECONDS:-300}"
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
          ''$COMPOSE_CLI --profile verifier down -v --remove-orphans >/dev/null 2>&1 || true
          podman rm -f $(podman ps -aq --filter "name=waltid-verifier") >/dev/null 2>&1 || true
          docker rm -f $(docker ps -aq --filter "name=waltid-verifier") >/dev/null 2>&1 || true
          rm -f .devenv/tunnel.url .devenv/tunnel.url.tmp .devenv/tunnel.log .devenv/tunnel.pending .devenv/*tunnel*.log
        }
        trap cleanup EXIT INT TERM

        # Pre-flight cleanup: remove any stale containers from previous runs or crashes
        ''$COMPOSE_CLI --profile verifier down -v --remove-orphans >/dev/null 2>&1 || true
        podman rm -f $(podman ps -aq --filter "name=waltid-verifier") >/dev/null 2>&1 || true
        docker rm -f $(docker ps -aq --filter "name=waltid-verifier") >/dev/null 2>&1 || true
        rm -f .devenv/tunnel.url .devenv/tunnel.url.tmp .devenv/tunnel.log .devenv/tunnel.pending .devenv/*tunnel*.log

        ''$COMPOSE_CLI --profile verifier up --force-recreate waltid-verifier
      '';
    };

    playground = {
      exec = ''
        mkdir -p .devenv
        export LOGS_DIR="''${LOGS_DIR:-$DEVENV_ROOT/logs}"
        export LOG_DIR="''$LOGS_DIR"
        mkdir -p "''$LOGS_DIR"

        cleanup() {
          rm -f .devenv/tunnel.url .devenv/tunnel.url.tmp .devenv/tunnel.log .devenv/tunnel.pending .devenv/*tunnel*.log
        }
        trap cleanup EXIT INT TERM

        resolve_url() {
          local fallback="''$1"
          local explicit="''${2:-}"

          if [ -n "''$explicit" ]; then
            echo "''$explicit"
            return 0
          fi

          echo "Waiting for Cloudflare Tunnel URL to be published..." >&2
          for i in {1..60}; do
            if [ ! -f .devenv/tunnel.pending ] && [ -s .devenv/tunnel.url ]; then
              local url
              url=$(cat .devenv/tunnel.url | tr -d '[:space:]')
              if [ -n "''$url" ]; then
                echo "✓ Tunnel URL detected: ''$url" >&2
                echo "''$url"
                return 0
              fi
            fi
            sleep 1
          done

          echo "Notice: Tunnel not detected, falling back to ''$fallback" >&2
          echo "''$fallback"
        }

        wait_for_readiness() {
          local name="''$1"
          local primary_url="''$2"
          local local_url="''$3"
          local max_attempts="''${4:-40}"

          echo "Waiting for ''$name readiness on ''$primary_url..."
          for i in $(seq 1 "''$max_attempts"); do
            local code
            code=$(curl -s -o /dev/null -w '%{http_code}' "''${primary_url%/}/" 2>/dev/null || true)
            if [ "''$code" = "200" ] || [ "''$code" = "302" ]; then
              echo "✓ ''$name is ready (HTTP ''$code)"
              return 0
            fi

            if [ "''$primary_url" != "''$local_url" ]; then
              local local_code
              local_code=$(curl -s -o /dev/null -w '%{http_code}' "''${local_url%/}/" 2>/dev/null || true)
              if [ "''$local_code" = "200" ] || [ "''$local_code" = "302" ]; then
                if [ "''$i" -ge 10 ]; then
                  echo "✓ ''$name is ready locally on ''$local_url (HTTP ''$local_code)"
                  return 0
                fi
              fi
            fi

            sleep 1
          done

          echo "Warning: ''$name readiness check timed out on ''$primary_url (last HTTP: ''$code)"
          return 1
        }

        TUNNEL_URL="$(resolve_url "http://localhost:8080" "''${PUBLIC_URL:-}")"
        export ISSUER_BASE_URL="''$TUNNEL_URL/issuer"
        export VERIFIER_PUBLIC_URL="''$TUNNEL_URL/verifier"
        export WALTID_BASE="http://localhost:7004"

        wait_for_readiness "Issuer" "''$ISSUER_BASE_URL" "http://localhost:3000" 40
        wait_for_readiness "Walt.id Verifier" "''$VERIFIER_PUBLIC_URL" "http://localhost:7004" 40

        export VCT_TYPE="''${VCT_TYPE:-graduation-record}"
        export VCT_VERSION="''${VCT_VERSION:-v1}"

        echo "=========================================================="
        echo " UniDipVeri Playground Showcase running"
        echo " UI:                        ''$TUNNEL_URL/playground"
        echo " VCT Type:                  ''$VCT_TYPE"
        echo " VCT Version:               ''$VCT_VERSION"
        echo " Issuer Public:             ''$ISSUER_BASE_URL"
        echo " Verifier Engine Public:    ''$VERIFIER_PUBLIC_URL"
        echo " Gateway Public:            ''$TUNNEL_URL"
        echo " Logs Dir:                  ''$LOGS_DIR"
        echo "=========================================================="

        bun run dev:playground
      '';
    };
  };
}
