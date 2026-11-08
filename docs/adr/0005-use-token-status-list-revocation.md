# 0005: Use IETF Token Status List for Credential Revocation

* Status: accepted
* Date: 2026-10-15

## Context and Problem Statement

Academic credentials require dependable, privacy-preserving revocation mechanisms to handle degree retractions, disciplinary actions, administrative corrections, or credential re-issuance.

The legacy IU-VC system attempted to manage revocation by calling an Ethereum Sepolia smart contract (`isValid(bytes32)`). In practice, public blockchain RPC calls introduced multi-second latency (12–15 second Ethereum block times), frequent rate-limiting errors, and financial gas costs. These reliability issues frequently forced relying parties to bypass revocation checks entirely.

How should UniDipVeri implement credential revocation to guarantee sub-millisecond verification, high availability, and ecosystem alignment?

## Decision Drivers

* **Verification Latency & Scalability:** Revocation checks must complete in under 5 milliseconds without blocking verifier execution.
* **Standards Alignment:** Must align with the OAuth and OpenID4VCI credential ecosystem.
* **Privacy Preservation:** The issuer's revocation endpoint must not learn which specific student credential is being verified by a relying party (no query tracking).
* **Availability:** Revocation data must be HTTP-cacheable, digitally signed, and resilient to transient network partitions.

## Considered Options

* **Option 1:** IETF Token Status List (`draft-ietf-oauth-status-list-21`) served as `application/statuslist+jwt` with RFC 1950 ZLIB compression.
* **Option 2:** Synchronous Ethereum Sepolia smart contract transactions and event logs (IU-VC approach).
* **Option 3:** W3C Bitstring Status List v1.0 (JSON-LD format).
* **Option 4:** Real-time query endpoints (OCSP-style REST lookups per credential ID).

## Decision Outcome

Chosen option: **Option 1**, because IETF Token Status List provides signed, tamper-proof status lists that pack 100,000+ credential statuses into a compressed payload of just a few kilobytes. Verifiers cache the list and evaluate status bits locally in sub-millisecond lookups without revealing which student's credential is being verified.

### Positive Consequences

* **Sub-Millisecond Verification:** Revocation verification requires only a single bitwise lookup (`(bytes[byteIdx] >> bitShift) & 1`) in memory.
* **Privacy:** Because the verifier downloads the entire compressed status list for an academic cohort, the university issuer cannot track which individual diplomas are being checked.
* **Standard HTTP Caching:** Status list JWTs include standard `Cache-Control` headers, reducing load on issuer infrastructure. Cache duration is configurable via `STATUS_LIST_TTL_SECONDS` (defaults to 300 seconds; set to 0 for `no-cache, no-store, must-revalidate` where `exp` is omitted), enabling operators to balance CDN caching efficiency against instant revocation propagation.
* **Persistent Cohort State:** The issuer can persist status bitstrings across restarts via `STATUS_LIST_PATH`.
* **Offline Resilience:** Verifiers with cached status lists can continue operating during transient network outages.

### Negative Consequences

* Immediate real-time revocation depends on the HTTP cache TTL configured on the status list endpoint (mitigated by configuring `STATUS_LIST_TTL_SECONDS=0` when instant revocation propagation is strictly required).
* Issuers must maintain an administrative service to toggle bits and re-sign status list JWTs.

## Pros and Cons of the Options

### Option 1: IETF Token Status List (`draft-ietf-oauth-status-list-21`)

* Good, because it is the primary revocation standard supported in OID4VCI and SD-JWT VC profiles.
* Good, because RFC 1950 ZLIB compression achieves massive compression ratios (over 99% reduction for sparse lists).
* Good, because verifiers perform zero synchronous network calls once the list is cached.
* Bad, because updating a single status requires re-signing and republishing the cohort bitstring.

### Option 2: Synchronous Public Blockchain Smart Contracts (IU-VC Approach)

* Good, because blockchain transactions provide an immutable append-only timestamp history.
* Bad, because public RPC nodes frequently time out or rate-limit requests.
* Bad, because block confirmation times (12–15s on Ethereum) make verification unacceptably slow.
* Bad, because transactions incur volatile cryptocurrency gas fees.

### Option 3: W3C Bitstring Status List v1.0

* Good, because it is supported in W3C JSON-LD ecosystems.
* Bad, because it is not natively supported by standard SD-JWT VC verification libraries, which expect JWT-based status tokens.

### Option 4: Real-Time Query Endpoints (OCSP-Style Lookups)

* Good, because status changes are immediately visible with zero cache delay.
* Bad, because every verification request leaks the student ID and verifier identity directly to the university in real time, destroying presentation privacy.
* Bad, because the university server becomes a single point of failure for all verifications worldwide.

## Links

* [Standards Profile](../architecture/02-standards-profile.md)
* [Issuer Status List Service](../../apps/issuer/src/services/status-list.ts)
* [Automated Interoperability Test Suite](../../scripts/issuer-verifier.interop.test.ts)
