# UniDipVeri

[![CI](https://github.com/huypengin/unidipveri/actions/workflows/ci.yaml/badge.svg)](https://github.com/huypengin/unidipveri/actions/workflows/ci.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-red.svg)](LICENSE)
[![Built with devenv](https://devenv.sh/assets/devenv-badge.svg)](https://devenv.sh)
[![Built with Nix](https://img.shields.io/static/v1?logo=nixos&logoColor=white&label=&message=Built%20with%20Nix&color=41439a)](https://builtwithnix.org)
[![TypeScript 5.x](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-white?logo=bun)](https://bun.sh/)
[![SD-JWT: RFC 9901](https://img.shields.io/badge/SD--JWT-RFC%209901-green)](https://datatracker.ietf.org/doc/rfc9901/)
[![SD-JWT VC: draft-19](https://img.shields.io/badge/SD--JWT%20VC-draft--19-green)](https://datatracker.ietf.org/doc/draft-ietf-oauth-sd-jwt-vc/)
[![OpenID4VCI: Pre-Auth (1.0 Final audit)](https://img.shields.io/badge/OpenID4VCI-Pre--Auth%20(1.0%20Final%20audit)-yellow)](https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0.html)

**UniDipVeri** is a reference implementation of an SD-JWT Verifiable Credential **issuer** for academic credentials (diplomas, transcripts, course records). It implements **IETF RFC 9901 (Selective Disclosure for JWTs)** and **draft-ietf-oauth-sd-jwt-vc-19**, issues credentials over the **OpenID4VCI Pre-Authorized Code flow; wire-format compatibility with 1.0 Final under audit**, and supports revocation with an **IETF Token Status List** (`draft-ietf-oauth-status-list-21`).

> **Status: research / reference prototype, not production software.**
> It does not claim conformance with the OpenID4VC High Assurance Interoperability Profile (HAIP) or with any official conformance suite. See [Known Limitations](#known-limitations) before deploying anything.

---

## Key Features

- **Selective disclosure (RFC 9901)**: Each selectively disclosable claim gets a salt from a CSPRNG (≥ 128 bits). Hidden claims are replaced by digests in sorted `_sd` arrays, or by `{"...": "<digest>"}` markers for array elements. Digest algorithms available: SHA-256 (default), SHA-384, SHA-512.
- **SD-JWT VC profile (draft-19)**: Credentials use media type `application/dc+sd-jwt` and header `typ: "dc+sd-jwt"`, with holder binding via `cnf.jwk` and a `vct` resolved from the schema.
- **Schema-agnostic core**: No credential schema is hardcoded. Credential types are declared in YAML and validated with Zod.
- **OpenID4VCI Pre-Authorized Code flow (wire-format compatibility with 1.0 Final under audit)**: Credential offers, optional transaction code (`tx_code`), token endpoint, nonce endpoint, and holder proof-of-possession verification. The Authorization Code flow is **not** implemented.
- **Revocation via Token Status List**: An RFC 1950 ZLIB-compressed bitstring served as a signed JWT (`application/statuslist+jwt`).
- **`did:web` issuer identifier**: The issuer publishes a DID document and the core resolves `did:web` identifiers and dereferences verification keys.
- **Registrar portal**: A schema-driven web form that shows each claim's disclosure policy and generates a QR code for wallets. Requires a schema to be configured via `SCHEMA_PATH`.
- **API documentation**: Swagger UI and an OpenAPI 3.0 document served by the issuer.
- **Third-Party Verifier Interoperability**: VCs issued by UniDipVeri are verified directly by independent, off-the-shelf third-party verifiers and standard libraries.

---

## Tested Wallets

Issuance was tested by scanning a credential offer and confirming that the wallet **received and stored** the credential:

| Wallet | Version | Received the VC |
| :--- | :--- | :--- |
| Paradym Wallet | 1.20.2 | Yes |
| Sphereon Wallet | 0.8.0 | Yes |
| Lissi ID-Wallet | 3.3.0 | Yes |

Other wallets were either not tested or failed to receive the credential. Wallets that require flows this issuer does not implement (for example the Authorization Code flow) are expected to fail.

---

## Known Limitations

- **All state is in memory.** Sessions, nonces and the **revocation status list** are lost on restart, so previously revoked credentials will appear valid again after a restart.
- **The default signing key is ephemeral.** If `ISSUER_PRIVATE_KEY_JWK` is not set, a new key is generated on every boot. The DID document changes, and credentials issued before the restart will no longer verify against it.
- **No authentication on sensitive endpoints.** The registrar portal, `/credential-offer`, and `/admin/*` (including revocation) are open. Anyone who can reach the service can create offers with arbitrary claims or revoke credentials.
- **Pre-Authorized Code flow only.** The Authorization Code flow is not implemented. Wallets requiring Authorization Code flow or HAIP profile features (for example PAR/PKCE, DPoP and wallet attestation) are not supported.
- **Limited privacy.** SD-JWT hides undisclosed claims but does not provide unlinkability: the issuer signature, `cnf.jwk`, and the digests are the same in every presentation of a credential, so verifiers can correlate them. It also offers no predicate proofs (for example "over 18" without the birth date).
- **Standards are moving.** The draft references (SD-JWT VC draft-19, Token Status List draft-21) are the revisions implemented here and may have been superseded.

---

## Architecture Overview

```mermaid
flowchart TD
    subgraph Client ["Holder (Wallet)"]
        W[Mobile / Web Wallet]
    end

    subgraph Verifier ["Independent Third-Party Verifier"]
        V[Off-the-shelf Verifier / Relying Party<br/>e.g. @sd-jwt/sd-jwt-vc, walt.id]
    end

    subgraph Apps ["Applications"]
        IssuerApp["@unidipveri/issuer<br/>(OID4VCI issuer, status list, registrar portal)"]
    end

    subgraph CoreEngine ["@unidipveri/core"]
        SchemaMod["Schema loader & validator<br/>(YAML / Zod)"]
        SDMod["SD-JWT primitives (RFC 9901)<br/>(salting, disclosures, masking)"]
        SignMod["JOSE signing<br/>(ES256 / EdDSA / ES384)"]
        DIDMod["did:web resolver"]
    end

    subgraph ConfigArtifacts ["Configuration"]
        Schemas["Credential schemas<br/>(YAML)"]
    end

    W <-->|OID4VCI Pre-Authorized Code flow| IssuerApp
    IssuerApp --> CoreEngine
    CoreEngine --> Schemas
    W -.->|Presents SD-JWT VC| V
    V -.->|Resolves DID / Status List| IssuerApp
```

---

## Technical Standards

| Component | Standard | Status | Scope in this project |
| :--- | :--- | :--- | :--- |
| SD-JWT | [RFC 9901](https://datatracker.ietf.org/doc/rfc9901/) | Published | Salted disclosures, nested object and array masking, reconstruction |
| SD-JWT VC | [draft-ietf-oauth-sd-jwt-vc-19](https://datatracker.ietf.org/doc/draft-ietf-oauth-sd-jwt-vc/) | Draft | `dc+sd-jwt` media type, `vct`, type metadata, `cnf` |
| Issuance | [OpenID4VCI](https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0.html) | Pre-Auth (1.0 Final audit) | OpenID4VCI Pre-Authorized Code flow; wire-format compatibility with 1.0 Final under audit |
| Revocation | [draft-ietf-oauth-status-list-21](https://datatracker.ietf.org/doc/draft-ietf-oauth-status-list/) | Draft | `application/statuslist+jwt` |
| Identifiers | [W3C DID Core](https://www.w3.org/TR/did-core/) with `did:web` | Recommendation | Publication and resolution over HTTPS |
| JOSE | RFC 7515, 7517, 7518 | IETF Standards | `ES256`, `EdDSA`, `ES384` |

Not implemented: OpenID4VP (presentation protocol), Authorization Code flow, DPoP, wallet/key attestation.

---

## Monorepo Structure

```
unidipveri/
├── apps/
│   ├── issuer/        # OID4VCI issuer, status list, registrar portal (@unidipveri/issuer)
│   │   ├── src/
│   │   │   ├── config.ts      # Zod environment configuration
│   │   │   ├── services/      # KeyManager, SessionManager, StudentRecords, StatusList
│   │   │   ├── routes/        # Discovery, DID doc, VCT metadata, Offer, Token, Credential, Portal, Docs
│   │   │   ├── app.ts         # HTTP request dispatcher and CORS
│   │   │   └── server.ts      # Bun.serve entrypoint
│   │   └── tests/             # 179 tests
│   └── playground/    # Placeholder (package.json only)
├── packages/
│   └── core/          # Schema-agnostic SD-JWT VC engine (@unidipveri/core)
│       ├── src/       # schema/, sd-jwt/, signing/, did/, config/
│       └── tests/     # 156 tests
├── schemas/           # YAML credential schemas
│   ├── graduation-record.v1.yaml
│   └── graduation-record.v2.yaml
├── devenv.nix
├── package.json
└── tsconfig.json
```

---

## Packages & Applications

### `@unidipveri/core`
The cryptographic and data-model engine. It keeps no global state and takes schemas, keys and configuration as arguments. Its only I/O is loading a schema file and `did:web` resolution over HTTP.
- **Salting**: ≥ 128-bit CSPRNG salts via Web Crypto.
- **Claim masking**: Turns nested JSON claims into masked payloads with sorted `_sd` arrays and `...` element markers, and reconstructs claims from presented disclosures.
- **Signing**: Signs the outer JWS (`typ: "dc+sd-jwt"`) and verifies signatures.
- **Resolver**: `did:web` resolution and verification-key dereferencing.

[Core documentation](packages/core/README.md)

### `@unidipveri/issuer`
The issuance service:
- **Discovery**: `/.well-known/openid-credential-issuer`, `/.well-known/oauth-authorization-server`, `/.well-known/did.json`, `/.well-known/jwt-vc-issuer`.
- **OID4VCI issuance**: Pre-authorized code, optional `tx_code`, proof-of-possession verification, and key binding into `cnf.jwk`.
- **Revocation**: Token Status List endpoint plus **unauthenticated** admin endpoints to revoke.
- **Registrar portal**: Schema-driven form and disclosure-policy badges.
- **Docs**: Swagger UI at `/docs`.

[Issuer documentation](apps/issuer/README.md)

---

## Getting Started

### Prerequisites

- **[Bun](https://bun.sh/)** (≥ 1.1), or **[devenv](https://devenv.sh/)** / Nix for a reproducible environment (includes Bun and Cloudflare tunnel tooling).

### Installation

```bash
git clone https://github.com/huypengin/unidipveri.git
cd unidipveri
bun install --frozen-lockfile
```

### Running Tests

The suite contains 335 automated tests (156 core + 179 issuer) covering the implemented behavior. It is not an official conformance suite.

> **Note on Off-the-Shelf Library Smoke Test:** The issuer test suite includes a smoke check against `@sd-jwt/sd-jwt-vc` (pinned in `devDependencies`). This test is strictly a development regression check to detect wire serialization breakage; it is **not** counted as independent third-party interoperability evidence since it executes with in-process key callbacks. Independent interop is evaluated via external verifier services documented in `docs/interop/matrix.md`.

```bash
bun run test        # all workspaces
bun run typecheck   # strict TypeScript checks

cd packages/core && bun test
cd apps/issuer && bun test
```

### Starting the Issuer

#### Option A: Bun

```bash
export SCHEMA_PATH="$(pwd)/schemas/graduation-record.v1.yaml"
export ISSUER_BASE_URL="http://localhost:3000"
export ISSUER_DID="did:web:localhost%3A3000"

bun run --filter "@unidipveri/issuer" dev
```

Plain HTTP on localhost is for local development only. Mobile wallets generally require a public HTTPS URL (see Option B).

#### Option B: devenv with a Cloudflare Quick Tunnel

`devenv up` provisions dependencies, starts the issuer, and optionally opens a Cloudflare tunnel so mobile wallets can reach it over HTTPS:

```bash
devenv up
```

Services:
- Registrar portal: `http://localhost:3000/`
- Swagger UI: `http://localhost:3000/docs`
- Issuer metadata: `http://localhost:3000/.well-known/openid-credential-issuer`
- DID document: `http://localhost:3000/.well-known/did.json`

When using a tunnel, set `ISSUER_BASE_URL` and `ISSUER_DID` to the public hostname, and set `ISSUER_PRIVATE_KEY_JWK` so the key survives restarts.

---

## Configuration Reference

Environment variables, validated with Zod at startup:

| Variable | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| `SCHEMA_PATH` | Path to the credential schema YAML | none | **Yes** |
| `SIGNING_ALGORITHM` | `ES256`, `EdDSA`, or `ES384` | `ES256` | No |
| `KEY_ID` | Key identifier in the DID document and JWKS | `key-1` | No |
| `ISSUER_IDENTIFIER_MODE` | Issuer identifier format: `did` (Variant A, `did:web`) or `https` (Variant B, HTTPS URL with `/.well-known/jwt-vc-issuer`) | `did` | No |
| `ISSUER_DID` | Issuer DID (must start with `did:`) | `did:web:localhost%3A3000` | No |
| `ISSUER_BASE_URL` | Public base URL of the issuer (use HTTPS outside local development) | `http://localhost:3000` | No |
| `VCT_BASE_URL` | Base URL used to resolve a relative `vctPath` | `ISSUER_BASE_URL` | No |
| `PORT` / `ISSUER_PORT` | HTTP listener port | `3000` | No |
| `ISSUER_HOST` | Bind address | `0.0.0.0` | No |
| `ISSUER_PRIVATE_KEY_JWK` | Private signing key as a JWK JSON string | **Ephemeral key generated on every boot** | No (strongly recommended) |

> **Warning:** Without `ISSUER_PRIVATE_KEY_JWK`, every restart changes the issuer key and invalidates verification of earlier credentials. Revocation state is also lost on restart.

---

## Credential Schema Definition

Schemas are YAML files validated against strict structural rules:

```yaml
vctPath: "/types/graduation-record/v1"
name: "Graduation Academic Record"
description: "Official university graduation record and transcript."

claims:
  studentId:
    type: string
    required: true
    sd: always_disclosed
    description: "Internal university student identifier"

  dateOfBirth:
    type: string
    format: date
    required: false
    sd: selectively_disclosable
    description: "Date of birth (YYYY-MM-DD)"

  papers:
    type: object
    required: true
    sd: always_disclosed
    properties:
      diploma:
        type: object
        required: true
        sd: selectively_disclosable
        properties:
          degreeName:
            type: string
            required: true
            sd: always_disclosed
          graduationDate:
            type: string
            format: date
            required: true
            sd: always_disclosed
```

### Selective Disclosure Rules
- `always_disclosed`: the claim is placed directly in the signed JWT payload.
- `selectively_disclosable`: the claim is paired with a ≥ 128-bit salt, encoded as a Base64URL disclosure (`[salt, claimName, claimValue]`), hashed (default `sha-256`), and replaced by its digest in the `_sd` array.
- **Nesting**: `always_disclosed` applies *within* its parent. In the example, `degreeName` and `graduationDate` are always disclosed relative to `diploma`, but they are only visible to a verifier when `diploma` itself is disclosed, because the whole `diploma` object sits behind a digest.
- **Arrays**: selectively disclosable array elements are replaced by `{"...": "<digest>"}` markers.

---

## Deployment Notes

UniDipVeri is a reference implementation. Before any real deployment:

- **State persistence**: Sessions, nonces and the revocation bitstring are in memory. Use a persistent, shared store (for example PostgreSQL or Redis); otherwise restarts reset revocation.
- **Key management**: Load keys from a KMS/HSM (AWS KMS, GCP Cloud KMS, Azure Key Vault, HashiCorp Vault) rather than environment variables or ephemeral memory.
- **Access control**: Protect the portal, `/credential-offer` and `/admin/*` with institutional SSO (SAML 2.0 / OIDC) and RBAC.
- **Traffic protection**: Add rate limiting and a WAF, and serve status lists (`/status/:id`) behind a CDN with sensible cache invalidation.
- **Interoperability profile**: If HAIP conformance is a requirement, additional work is needed (see Known Limitations).

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
