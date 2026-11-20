# 0008: Adopt Just-In-Time (JIT) Status List Allocation and OID4VCI Batch Distribution

* Status: accepted
* Date: 2026-11-15

## Context and Problem Statement

Academic credential systems must support the mass issuance of degrees to entire graduating cohorts (hundreds to thousands of students per academic term). The legacy IU-VC system attempted to handle batch issuance through a client-heavy, blockchain-anchored architecture:
1. University staff loaded student PDFs into a browser application (`IU-cert-university`).
2. The browser computed SHA-256 hashes of academic component files (diploma, transcript, recruiter submission) and constructed an in-memory Merkle tree.
3. The staff member signed an Ethereum transaction via MetaMask (EIP-1193) to deploy a dedicated `AnchorRegistryBatch` smart contract on Ethereum Sepolia, anchoring the Merkle root on-chain.
4. The system generated static, pre-signed `vc.json` files (`DataIntegrityProof` with `eddsa-rdfc-2022`) for offline download.
5. Revocation was handled on-chain: staff initiated another MetaMask transaction calling `revoke(bytes32)` on the smart contract using the component hash as the revocation key. Verifiers evaluated revocation by querying `isValid(bytes32)` against public Ethereum JSON-RPC nodes.

In practice, legacy IU-VC's on-chain architecture suffered from severe operational and security flaws:
- **Block Latency & RPC Rate Limits:** Ethereum block confirmation times (12–15 seconds) and flaky public RPC nodes caused frequent verifier timeouts.
- **Gas Costs & MetaMask Friction:** Registrars were forced to hold and manage cryptocurrency balances and sign browser transactions for routine administrative tasks.
- **Public On-Chain Linkability:** Every revocation transaction was publicly broadcast and permanently indexed on block explorers (such as Etherscan), linking institutional activities to public Ethereum addresses.
- **Bearer Credential Insecurity:** Distributing pre-signed `vc.json` files offline bypassed cryptographic holder key binding (`cnf.jwk`). If an offline file was intercepted in transit (e.g. over unencrypted student email), anyone could present it without proof-of-possession.

UniDipVeri resolves the blockchain and latency bottlenecks by adopting the **IETF Token Status List (`draft-ietf-oauth-status-list-21`)**, an RFC 1950 ZLIB-compressed bitstring served over HTTPS (`application/statuslist+jwt`) that enables sub-millisecond, query-private revocation checks (ADR-0005).

However, scaling revocation and issuance to cohort batch operations introduces a critical architectural dilemma:
- If the issuer pre-signs credentials and pre-allocates status list bit indices at batch creation time (e.g., indices 0 to 4,999 for a 5,000-student cohort):
  - **Unclaimed Offers ("Ghost Bits"):** What happens when students fail to claim their credentials, defer graduation, or drop out? Their pre-allocated bit positions remain permanently occupied in the status list bitstring, resulting in "ghost bits" and unnecessary bitstring bloat.
  - **Loss of Holder Binding:** Pre-signing credentials offline before the student connects their wallet prevents binding the credential to the student's hardware-backed key (`cnf.jwk`).
  - **Administrative Complexity:** Revoking a credential requires registrars to manually look up and track raw numeric bit indices rather than identifying students by their institutional Student ID.

How should UniDipVeri architect batch cohort issuance and revocation to guarantee cryptographic holder key binding, maintain a compact status list without orphaned bits, and provide intuitive administrative revocation by Student ID?

---

## Decision Drivers

* **Zero Blockchain Overhead:** Eliminate all dependency on Ethereum smart contracts, cryptocurrency gas fees, and browser wallet extensions (MetaMask).
* **Cryptographic Holder Key Binding (`cnf.jwk`):** Guarantee that every issued credential is bound to the student's hardware-backed wallet key via OpenID4VCI Proof-of-Possession.
* **Status List Compactness & Hygiene:** Prevent orphaned or "ghost" bit allocations for unredeemed credential offers, maintaining high ZLIB compression efficiency.
* **Operational Simplicity for Registrars:** Allow university staff to revoke credentials using the familiar institutional Student ID (`studentId`) rather than tracking internal bit indices.
* **Standard OID4VCI Delivery:** Provide a turnkey bulk distribution package containing standard `openid-credential-offer://` QR codes, deep links, and batch manifests without external server dependencies.

---

## Considered Options

* **Option 1: Legacy IU-VC Model (On-Chain Smart Contract Anchoring + Offline Pre-Signed `vc.json` Files)**
* **Option 2: Offline Pre-Signed SD-JWT VCs with Pre-Allocated Status List Indices**
* **Option 3: Pre-Authorized Code Batch Offer Distribution with Just-In-Time (JIT) Status List Allocation (Chosen)**

---

## Decision Outcome

Chosen option: **Option 3: Pre-Authorized Code Batch Offer Distribution with Just-In-Time (JIT) Status List Allocation**.

### Architecture & Lifecycle Flow

1. **Batch Ingestion & Validation:**
   - The registrar uploads a CSV file containing student graduation records via the Registrar Portal (`/batch-issue`) or REST endpoint (`POST /batch/offers`).
   - The CSV parser (`packages/core/src/schema/csv-parser.ts`) maps tabular rows to nested claim structures and validates all fields against the declarative credential schema (`schemas/graduation-record.v1.yaml`).

2. **Pre-Authorized Offer Generation & Packaging:**
   - The batch issuer service (`apps/issuer/src/services/batch-issuer.ts`) generates individual OpenID4VCI 1.0 Final Pre-Authorized Code sessions for each valid record.
   - For each student, the service generates an `openid-credential-offer://` URI, an inline PNG QR code, and an authorization session bound to the student's claims, providing direct PIN-less pre-authorized codes for streamlined cohort claiming (with `tx_code` transaction PIN protection supported on the interactive `/credential-offer` endpoint).
   - An in-memory ZIP archive (`batch-<id>.zip`) is assembled using a zero-dependency DEFLATE archiver (`apps/issuer/src/services/zip-archive.ts`) containing:
     - `manifest.json`: Batch metadata, timestamp, error reports, and status list endpoint URL.
     - `offers.csv`: Tabular summary mapping student IDs, names, offer URIs, and pre-authorized codes for registrar distribution.
     - `qr-codes/<studentId>_offer.png`: High-resolution scannable QR code images.

3. **Just-In-Time (JIT) Status List Allocation:**
   - **Crucial Rule:** No status list bit index is allocated during batch offer creation.
   - When the student scans their QR code with a digital mobile wallet (such as Paradym, Sphereon, or Lissi) and completes the OpenID4VCI exchange:
     - The wallet presents a Proof-of-Possession JWT at `POST /credential`.
     - The issuer verifies the proof and extracts the holder's public key (`cnf.jwk`).
     - **Only at this moment** does the issuer allocate a sequential bit index from the Token Status List (`allocateIndex()`).
     - The issuer embeds the status claim (`status.status_list.idx`) into the SD-JWT VC payload and signs the outer JWS (`typ: "dc+sd-jwt"`).
     - The issuer maps `studentId -> index` in an internal `subjectIndexMap`.

4. **Subject-Level Administrative Revocation:**
   - To revoke a student's degree, registrar staff invoke `POST /status/revoke` or `POST /admin/revoke` providing either the raw bit index (`index`) or the institutional identifier (`subjectId` or `studentId`).
   - The status service dereferences the student ID via `subjectIndexMap`, sets the corresponding bit in the RFC 1950 ZLIB bitstring to `1`, increments the list version, and persists the updated bitstring.

---

### Positive Consequences

* **Zero Ghost Bits:** Unclaimed offers, abandoned sessions, or student deferrals never consume status list bit positions. The bitstring only grows in proportion to actual issued credentials.
* **Uncompromised Holder Key Binding:** Every issued credential is bound to the holder's active wallet key (`cnf.jwk`), preventing stolen bearer-file attacks.
* **No Blockchain Friction:** Verification is sub-millisecond and off-chain; issuance requires zero gas fees or MetaMask transactions.
* **Human-Centric Administration:** Clerks manage revocations by Student ID, eliminating manual lookup tables or risk of revoking the wrong index.
* **Zero-Dependency Portability:** The ZIP packaging and DEFLATE compression operate purely in memory using standard runtime primitives without third-party native binaries.

### Negative Consequences

* **Session Expiry Management:** Unclaimed pre-authorized code sessions must expire gracefully, requiring periodic session cleanup.
* **Subject-to-Index State Mapping:** The issuer must persist the `subjectIndexMap` alongside the status list bitstring across server restarts to maintain Student ID revocation capabilities.

---

## Pros and Cons of the Options

### Option 1: Legacy IU-VC Model (On-Chain Smart Contract Anchoring + Static `vc.json`)

* Good, because blockchain transactions provide an immutable append-only timestamp history.
* Bad, because verifiers suffer 12–15 second block latencies and public RPC node rate limiting.
* Bad, because every issuance and revocation costs cryptocurrency gas fees and requires MetaMask browser interaction.
* Bad, because credentials lack holder key binding (`cnf.jwk`) and can be intercepted as bearer tokens.
* Bad, because public smart contract transactions link student credential activities on public block explorers.

### Option 2: Offline Pre-Signed SD-JWT VCs with Pre-Allocated Status List Indices

* Good, because all cryptographic operations occur upfront in a single batch script.
* Bad, because pre-signing credentials offline makes holder key binding (`cnf.jwk`) impossible, violating OpenID4VCI security.
* Bad, because unredeemed credential offers permanently occupy bit positions ("ghost bits"), bloating status list size.
* Bad, because revoked or cancelled offers cannot cleanly recycle allocated bit positions without risking collisions.

### Option 3: Pre-Authorized Code Batch Distribution with Just-In-Time (JIT) Status List Allocation

* Good, because it adheres strictly to OpenID4VCI 1.0 Final Pre-Authorized Code flow with full holder key binding.
* Good, because status list bit positions are allocated only upon actual wallet redemption, guaranteeing zero orphaned bits.
* Good, because registrars can revoke credentials directly by Student ID (`studentId`).
* Good, because cohort distribution is packaged into a self-contained ZIP archive containing QR codes, manifest, and deep links.
* Bad, because the issuer must maintain an active HTTP listener to fulfill redemption requests when students scan their offers.

---

## Links

* [ADR-0005: Use IETF Token Status List for Credential Revocation](0005-use-token-status-list-revocation.md)
* [System Architecture: End-to-End Dataflow](../architecture/03-system-architecture.md)
* [Operations and Governance](../architecture/05-operations-and-governance.md)
* [Batch Issuer Service](../../apps/issuer/src/services/batch-issuer.ts)
* [Status List Service](../../apps/issuer/src/services/status-list.ts)
* [CSV Ingestion Parser](../../packages/core/src/schema/csv-parser.ts)
