# System Architecture: End-to-End Dataflow, Key Management, and Security Boundaries

## 1. System Overview

UniDipVeri implements a full-lifecycle verifiable credential architecture consisting of three operational roles:
1. **Issuer Application (`apps/issuer`):** An OpenID4VCI 1.0 Final server providing an interactive registrar portal, pre-authorized code session management, direct REST offer issuance (`POST /credential-offer`), cryptographic credential issuance (`typ: "dc+sd-jwt"`), W3C `did:web` publishing, and Token Status List revocation. Inbound SIS webhook integration adapters are deliberately decoupled from this reference prototype, operating as a future enterprise ingestion boundary.
2. **Core SD-JWT VC Engine (`packages/core`):** A schema-agnostic TypeScript library providing RFC 9901 salting and recursive claim masking, JWS signing, and W3C `did:web` identifier resolution.
3. **External Relying Party / Verifier (`walt.id` Verifier) & Playground Showcase (`apps/playground`):** Credential verification is not performed by a university-operated verifier backend; it is delegated to independent, off-the-shelf relying party verifiers (specifically, the `walt.id` verifier container) using OpenID4VP 1.0 Final and DCQL. A verifier demonstration showcase (`apps/playground`) provides a human-readable web UI that initiates verification sessions against the `walt.id` verifier, presents scannable QR codes to mobile wallets, and displays verified claim disclosures and audit results.

```mermaid
flowchart TD
    Registrar["Registrar Portal /<br/>Student Records API"]
    Issuer["Issuance Server (apps/issuer)<br/>- KeyManager<br/>- StatusList Manager"]
    Wallet["Digital Mobile Wallet<br/>(Paradym / Sphereon / Lissi)<br/>- Secure Storage<br/>- Consent Barrier"]
    WebInfra["Public Web Infrastructure<br/>- did:web Document (/.well-known/did.json)<br/>- VCT Metadata (/types/*)<br/>- Status List Endpoint (/status/*)"]
    
    subgraph VerifierEcosystem ["Relying Party / Verifier Ecosystem"]
        Playground["Playground Showcase (apps/playground)<br/>- Web UI & QR Display<br/>- Audit Visualizer"]
        WaltID["walt.id Verifier Container<br/>- Off-the-shelf OID4VP Verifier<br/>- DCQL & Policy Engine"]
        Playground -->|Create session / Poll results| WaltID
    end

    Registrar --> Issuer
    Issuer -->|OID4VCI 1.0 Final<br/>Credential Offer / Pre-Auth Flow| Wallet
    Issuer -->|Publish Status List<br/>application/statuslist+jwt| WebInfra
    Wallet -->|OID4VP 1.0 Final<br/>DCQL Presentation| WaltID
    WaltID -.->|Resolve DID & Status| WebInfra
```

---

## 2. End-to-End Issuance Protocol Flow (OpenID4VCI 1.0 Final)

Credential issuance follows the Pre-Authorized Code Flow:

```mermaid
sequenceDiagram
    autonumber
    actor Registrar as University Registrar
    participant Issuer as apps/issuer
    actor Holder as Student (Wallet)
    
    Registrar->>Issuer: 1. Input student claims & select schema (POST /credential-offer)
    Issuer->>Issuer: Create session, generate pre-auth code & CSPRNG transaction PIN
    Issuer-->>Registrar: Return Offer URI & QR Code (openid-credential-offer://)
    
    Holder->>Issuer: 2. Scan QR & fetch metadata (GET /.well-known/openid-credential-issuer)
    Issuer-->>Holder: Return issuer metadata & supported credentials
    
    Holder->>Issuer: 3. Exchange pre-auth code + PIN (POST /token)
    Issuer->>Issuer: Atomic code burn, timing-safe PIN check, issue c_nonce
    Issuer-->>Holder: Return access_token & c_nonce
    
    Holder->>Issuer: 4. Request credential with Holder Proof (POST /credential)
    Issuer->>Issuer: Verify proof-of-possession JWT, extract cnf.jwk
    Issuer->>Issuer: Mask claims with 128-bit CSPRNG salts (RFC 9901)
    Issuer->>Issuer: Sign outer JWS (typ: "dc+sd-jwt") with issuer private key
    Issuer-->>Holder: Return SD-JWT credential & disclosures
```

### Key Security Invariants in Issuance

1. **Atomic Code Burning:** Pre-authorized codes are stored with single-use atomic consumption semantics. A second presentation of the same authorization code immediately fails, preventing replay attacks.
2. **Timing-Safe PIN Verification:** The student transaction PIN is checked using constant-time comparison (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.
3. **Holder Key Binding Extraction:** The holder's Proof-of-Possession JWT must be bound to the issuer's issued `c_nonce`. The extracted JWK is sanitized and embedded in the credential's `cnf.jwk` claim.
4. **128-Bit CSPRNG Entropy:** Every selectively disclosable claim receives a uniquely generated salt with a minimum of 16 cryptographically random bytes.

---

## 3. End-to-End Verification Protocol Flow (OpenID4VP 1.0 Final & DCQL)

Presentation and verification follow the DCQL query lifecycle with the external `walt.id` verifier:

```mermaid
sequenceDiagram
    autonumber
    actor VerifierUser as Employer / HR Admin
    participant Playground as apps/playground
    participant WaltID as walt.id Verifier (Container)
    actor Holder as Student (Wallet)
    participant Issuer as Public Web (apps/issuer)
    
    VerifierUser->>Playground: 1. Select scenario preset or custom claims (GET /api/discovery)
    Playground->>WaltID: 2. Create OID4VP session with dynamic DCQL query (POST /api/session)
    WaltID-->>Playground: Return authorization request URL & session ID
    Playground-->>VerifierUser: Display scannable QR code (openid4vp://authorize?...)
    
    Holder->>WaltID: 3. Scan QR & fetch authorization request
    WaltID-->>Holder: Return DCQL Query & challenge nonce
    
    Holder->>Holder: 4. Wallet filters disclosures matching DCQL query
    Holder->>Holder: Sign Key Binding JWT (kb+jwt) with holder key
    Holder->>WaltID: 5. Submit Presentation (direct_post)
    
    WaltID->>Issuer: 6. Dereference Issuer DID (GET /.well-known/did.json)
    Issuer-->>WaltID: Return W3C DID Document & public key
    WaltID->>WaltID: Verify outer JWS signature against issuer public key
    WaltID->>WaltID: Hash raw Base64URL disclosure strings & match to _sd
    WaltID->>WaltID: Verify Holder Key Binding JWT (aud, nonce, sd_hash)
    
    WaltID->>Issuer: 7. Fetch Token Status List (GET /status/:id)
    Issuer-->>WaltID: Return signed statuslist+jwt
    WaltID->>WaltID: Decompress RFC 1950 ZLIB bitstring & inspect bit at idx
    
    Playground->>WaltID: 8. Poll verification session status
    WaltID-->>Playground: Return verification result & verified disclosures
    Playground-->>VerifierUser: Display verified claims & audit results
```

---

## 4. Key Management and Cryptographic Boundaries

```mermaid
flowchart TD
    subgraph IssuerTier ["Issuer Tier (apps/issuer)"]
        IK["Long-lived asymmetric keypair (ES256 / EdDSA / ES384)"]
        IPub["Published via did:web"]
        ISign["Signs outer JWS (dc+sd-jwt)"]
        IStatus["Signs Token Status List JWT"]
    end

    subgraph HolderTier ["Holder Tier (Wallet)"]
        HK["Ephemeral or device-bound keypair"]
        HProof["Proof-of-possession signing"]
        HKB["Key Binding JWT (kb+jwt) with aud, nonce, sd_hash"]
    end

    subgraph VerifierTier ["Relying Party Tier (External walt.id Verifier)"]
        VAuto["Autonomous resolution: Dereferences issuer key via did:web"]
        VNoPSK["Zero hardcoded pre-shared keys or proprietary webhooks"]
        VNonce["Nonce generation via CSPRNG for replay protection"]
    end
```

1. **Algorithm Agility:** Private keys can be configured as ECDSA with curve P-256 (`ES256`), Ed25519 (`EdDSA`), or ECDSA with curve P-384 (`ES384`). The key generator utility (`scripts/generate-key.ts`, run via `bun run keygen`) creates and formats exportable JWK keypairs matching all supported curves.
2. **DID Web Resolution:** The relying party verifier (`walt.id`) dereferences `did:web:issuer.university.edu` by requesting `https://issuer.university.edu/.well-known/did.json`, parsing the DID Document, and resolving the cryptographic public key from the matching `verificationMethod.publicKeyJwk`.
3. **Revocation Independence:** Revocation verification does not require contacting a live transaction gateway or blockchain node; status is determined from the signed, compressed status list bitstring.
