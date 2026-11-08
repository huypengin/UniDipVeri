# 0007: Single-Hostname Reverse Proxy Architecture (1 Hostname Gateway)

* Status: accepted
* Date: 2026-11-08

## Context and Problem Statement

UniDipVeri previously operated in local development using multiple Cloudflare Quick Tunnels, where each service had its own dedicated public domain:
- Issuer: `https://<issuer-tunnel>.trycloudflare.com` (mounted at domain root `/`)
- Walt.id Verifier: `https://<verifier-tunnel>.trycloudflare.com` (mounted at domain root `/`)
- Playground: `http://localhost:3001`

While multi-tunnel setups keep routing simple (every service resides at `/`), deploying UniDipVeri for public demonstration on cloud platforms like Render (free tier) presents a strict constraint: Render Web Services provide exactly **one** external public hostname (`https://<service>.onrender.com`). Furthermore, running multiple independent tunnels locally introduced process race conditions, pipe buffer delays, and redundant network daemon overhead.

To support both a unified Render demo deployment and local containerized environments without modifying application business logic, UniDipVeri migrated to a single-hostname architecture powered by an internal Caddy reverse proxy on port 8080:
- Root (`/`): Redirects to `/playground/`
- Playground Showcase: Scoped under `/playground/*` and `/api/*`
- Issuer Registrar Portal & Protocol: Scoped under `/issuer/*`
- Walt.id Verifier: Scoped under `/verifier/*` and `/verification-session/*`

What are the architectural limits, invariants, and trade-offs introduced by migrating from multi-domain to a single-hostname reverse proxy?

---

## Decision Drivers

* **Single Public Hostname:** The entire demonstration stack (Playground, Issuer, Verifier) must operate behind a single public domain on Render.
* **Standard Protocol Compliance:** All endpoints must remain fully compliant with OpenID4VCI 1.0 Final, OpenID4VP 1.0 Final, RFC 9901, and W3C `did:web`.
* **Zero Application Code Pollution:** Application services (`apps/issuer`, `apps/playground`) must remain decoupled from deployment topology; routing adjustments must reside in the deployment configuration.
* **Ecosystem Wallet Interoperability:** Off-the-shelf digital wallets (e.g., Paradym, Walt.id, Sphereon) must resolve discovery documents and complete credential issuance without errors.

---

## Technical Invariants and Architectural Limits

Migrating from dedicated per-service domains to a path-scoped single-hostname architecture introduces several key limits and constraints:

### 1. RFC 8414 & OID4VCI 1.0 Final Path Insertion Rule
- **The Invariant:** When a Credential Issuer Identifier contains a path component (e.g. `https://<domain>/issuer`), standard OID4VCI 1.0 Final and RFC 8414 clients do **not** query `https://<domain>/issuer/.well-known/...`. Instead, they insert `/.well-known/openid-credential-issuer` between the host and path component:
  `https://<domain>/.well-known/openid-credential-issuer/issuer`
- **The Limit:** If the gateway only proxies `/issuer/*` and ignores root `/.well-known/*`, standard wallets (such as Paradym) receive empty responses or 404s, failing with errors such as *"cannot extract information"*.
- **Gateway Requirement:** The reverse proxy must explicitly handle and rewrite path-inserted well-known requests:
  - `handle /.well-known/openid-credential-issuer*` -> rewrite to `/.well-known/openid-credential-issuer`
  - `handle /.well-known/oauth-authorization-server*` -> rewrite to `/.well-known/oauth-authorization-server`
  - `handle /.well-known/openid-configuration*` -> rewrite to `/.well-known/openid-configuration`

### 2. W3C `did:web` Path Resolution Divergence
- **The Invariant:** Per the W3C `did:web` specification:
  - A root DID (`did:web:<domain>`) resolves to `https://<domain>/.well-known/did.json`.
  - A path-scoped DID (`did:web:<domain>:issuer`) resolves to `https://<domain>/issuer/did.json`.
- **The Limit:** The upstream Issuer application natively listens on `/.well-known/did.json`.
- **Gateway Requirement:** The reverse proxy must handle both W3C resolution pathways:
  - Intercept `/issuer/did.json` and rewrite to `/.well-known/did.json`.
  - Intercept root `/.well-known/did.json` and proxy to the Issuer.

### 3. Trailing Slash Sensitivity & HTTP 308 Normalization
- **The Invariant:** Reverse proxy path strippers (such as Caddy's `handle_path /issuer/*`) strictly match URI paths containing the trailing slash.
- **The Limit:** Direct browser requests or bookmarks to `https://<domain>/issuer` or `https://<domain>/playground` without a trailing slash fail to match and produce blank pages or 404 responses.
- **Gateway Requirement:** The reverse proxy must enforce canonical trailing slash normalization redirects:
  - `redir /issuer /issuer/ 308`
  - `redir /playground /playground/ 308`
  - `redir /verifier /verifier/ 308`

### 4. Dynamic Base Path Resolution in Frontend Templates
- **The Invariant:** In a subpath-routed architecture, static HTML pages and client-side JavaScript cannot rely on root-relative paths (e.g. `<a href="/docs">` or `fetch("/api/session")`).
- **The Limit:** Hardcoded root-relative links in portal or documentation views break when services are mounted behind a subpath.
- **Application Requirement:** All internal hyperlinks, documentation back-links, and client fetch requests must derive dynamically from the configured `baseUrl` (e.g. `${config.baseUrl}/docs`, `${config.baseUrl}/credential-offer`).

### 5. Verifier Callback and Session Scoping
- **The Invariant:** OpenID4VP verifier engines (such as Walt.id) generate authorization request URLs passed to wallets in QR codes.
- **The Limit:** When Walt.id is hosted behind `/verifier`, its default session callback URLs (`/verification-session/*`) must match the external gateway routing.
- **Gateway Requirement:** Walt.id must be configured with `url_prefix: ${verifierPublicUrl}/verification-session`, and the gateway must proxy both `/verifier/*` and `/verification-session/*` to the Walt.id instance.

### 6. Single Point of Failure (SPOF)
- **The Limit:** All traffic across Playground, Issuer, and Verifier multiplexes through a single Caddy gateway and a single public tunnel/domain. A syntax error in `Caddyfile` or a crash in the reverse proxy process affects all services simultaneously, unlike independent per-service domains.

---

## Decision Outcome

Chosen: **Single-Hostname Reverse Proxy Architecture (Caddy Gateway)** with RFC 8414 path-insertion rewrites, W3C `did:web` path resolution, and trailing slash normalization.

### Positive Consequences
* Fully enables deployment on Render's single Web Service model without requiring paid blueprints or multi-service orchestration.
* Eliminates multi-tunnel race conditions and port proliferation in local developer environments (`devenv.nix`).
* Maintains full interoperability with mobile wallets (Paradym, Walt.id) through standard-compliant RFC 8414 and OID4VCI discovery rewrites.
* Preserves clean application code separation without injecting domain-specific routing hacks into `apps/` or `packages/`.

### Negative Consequences
* Reverse proxy configuration (`Caddyfile`) must be carefully maintained to ensure all well-known rewrites and path strippers remain aligned with upstream services.
* Development testing requires awareness of the dual-path discovery model (subpath `/issuer/*` vs root `/.well-known/*`).
