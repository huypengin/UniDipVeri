{ pkgs, ... }:

{
  languages.javascript = {
    enable = true;
    bun.enable = true;
  };

  packages = [
    pkgs.cloudflared
  ];

  processes = {
    tunnel = {
      exec = ''
        mkdir -p .devenv
        rm -f .devenv/tunnel.log
        echo "Starting Cloudflare Quick Tunnel on port 3000..."
        cloudflared tunnel --url http://localhost:3000 2>&1 | tee .devenv/tunnel.log
      '';
    };

    issuer = {
      exec = ''
        mkdir -p .devenv
        if [ -n "''${ISSUER_BASE_URL:-}" ]; then
          echo "Using preconfigured ISSUER_BASE_URL: ''$ISSUER_BASE_URL"
        else
          echo "Waiting for Cloudflare Tunnel public URL to be assigned..."
          for i in {1..40}; do
            if [ -f .devenv/tunnel.log ] && grep -o 'https://[-a-zA-Z0-9.]*\.trycloudflare\.com' .devenv/tunnel.log >/dev/null 2>&1; then
              TUNNEL_URL=$(grep -o 'https://[-a-zA-Z0-9.]*\.trycloudflare\.com' .devenv/tunnel.log | head -n 1)
              break
            fi
            sleep 0.5
          done

          if [ -z "''${TUNNEL_URL:-}" ]; then
            echo "Warning: Cloudflare tunnel URL not detected after 20s. Falling back to http://localhost:3000."
            TUNNEL_URL="http://localhost:3000"
            DOMAIN="localhost%3A3000"
          else
            DOMAIN=$(echo "''$TUNNEL_URL" | sed -e 's|^https://||' -e 's|/.*$||')
          fi

          export ISSUER_BASE_URL="''$TUNNEL_URL"
          export VCT_BASE_URL="''$TUNNEL_URL"
          export ISSUER_DID="did:web:''$DOMAIN"
        fi

        export SCHEMA_PATH="''${SCHEMA_PATH:-$(pwd)/schemas/graduation-record.v1.yaml}"
        export PORT="''${PORT:-3000}"

        echo "=========================================================="
        echo " UniDipVeri Issuer running via devenv process manager"
        echo " Base URL:    ''$ISSUER_BASE_URL"
        echo " Issuer DID:  ''$ISSUER_DID"
        echo " Portal:      ''$ISSUER_BASE_URL"
        echo " Swagger:     ''$ISSUER_BASE_URL/docs"
        echo " Discovery:   ''$ISSUER_BASE_URL/.well-known/openid-credential-issuer"
        echo " DID Doc:     ''$ISSUER_BASE_URL/.well-known/did.json"
        echo "=========================================================="

        bun run --watch apps/issuer/src/server.ts
      '';
    };
  };
}
