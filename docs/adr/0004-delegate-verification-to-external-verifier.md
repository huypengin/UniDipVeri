# 0004: Delegate Verification to Off-the-Shelf Standard Verifier (walt.id)

* Status: accepted
* Date: 2026-10-21

## Context and Problem Statement

In decentralized identity architectures, relying parties (such as enterprise employers, background check agencies, and government portals) independently verify presented credentials. In the open SSI trust triangle, universities act as issuers, while relying parties deploy their own verifiers.

The legacy IU-VC system attempted a fragile two-phase verification architecture: generic W3C checks were offloaded to an external Walt.id Docker container, which then fired an unauthenticated HTTP webhook back to an IU-VC service to recompute custom Merkle proofs and make Ethereum RPC calls. Furthermore, critical signature checks on `did:web` were left stubbed with `return true`.

How should UniDipVeri structure its verification approach to guarantee cryptographic correctness, eliminate fragile external webhooks, avoid maintaining an unnecessary proprietary verifier application, and maximize ecosystem compatibility?

## Decision Drivers

* **Zero Hand-Rolled Crypto:** Cryptographic verification of JWS signatures, Base64URL disclosure hashes, Holder Key Binding JWTs, and Token Status List revocation must adhere strictly to open standards (RFC 9901, `draft-ietf-oauth-sd-jwt-vc-19`, `draft-ietf-oauth-status-list-21`, OpenID4VP 1.0 Final).
* **Ecosystem Interoperability:** Credentials issued by UniDipVeri must be directly verifiable by standard, off-the-shelf relying party verifiers without requiring custom university plugins or webhooks.
* **Operational Simplicity:** Avoid building and maintaining an in-house verifier application (`apps/verifier`) when standard relying-party verifiers already exist in the open ecosystem.

## Considered Options

* **Option 1:** Build a custom, proprietary in-house relying party verifier service (`apps/verifier`).
* **Option 2:** Retain proprietary webhook callbacks to verify non-standard credential structures (IU-VC approach).
* **Option 3:** Delegate credential presentation verification entirely to an off-the-shelf, standard-compliant verifier (`walt.id` Verifier 2 container) using OpenID4VP 1.0 Final and DCQL, accompanied by a demonstration showcase (`apps/playground`) and an automated interoperability test suite (`scripts/issuer-verifier.interop.test.ts`).

## Decision Outcome

Chosen option: **Option 3**, because UniDipVeri credentials strictly adhere to published open standards. An off-the-shelf verifier like Walt.id Verifier 2 verifies SD-JWT VCs directly and autonomously over standard HTTPS without any custom university backend, proprietary webhooks, or secondary network hops.

For interactive demonstrations, `@unidipveri/playground` orchestrates verification sessions with the Walt.id verifier and renders visual results. It supports dynamic DCQL query construction from schema-discovered leaf claims (`/api/discovery`), scenario presets (Diploma, Transcript & GPA, Student Identity, Full Academic Record), and custom query payloads. For automated testing, `scripts/issuer-verifier.interop.test.ts` acts as the automated holder and verifies presentations against the external Walt.id container.

### Positive Consequences

* Eliminates the need to develop, operate, or maintain a proprietary verifier application (`apps/verifier`).
* Eliminates unauthenticated webhook handoffs and two-phase verification latency.
* Proves genuine interoperability: credentials issued by UniDipVeri are accepted by standard third-party verifiers out of the box.
* The Walt.id verifier autonomously dereferences `did:web` over HTTPS, validates outer signatures, hashes raw disclosure strings, validates Holder Key Binding JWTs (`aud`, `nonce`, `sd_hash`), and checks Token Status List revocation.

### Negative Consequences

* Running live interactive demonstrations or end-to-end integration tests requires running the Walt.id Verifier 2 container (orchestrated via `docker-compose.yml`).

## Pros and Cons of the Options

### Option 1: Proprietary In-House Verifier Application (`apps/verifier`)

* Good, because it provides complete internal control over verification logging and route behavior.
* Bad, because in decentralized identity, relying parties deploy their own verifiers; universities do not operate verification services for employers.
* Bad, because it introduces significant maintenance overhead duplicating capabilities already provided by standard open-source verifiers.

### Option 2: Proprietary Synchronous Webhook Callbacks (IU-VC Approach)

* Good, because it accommodates legacy non-standard Merkle trees and centralized database lookups.
* Bad, because placing synchronous webhooks on the critical path of verification introduces temporal coupling, network latency, and availability bottlenecks.
* Bad, because requiring verifiers to phone home to an issuing university's webhook destroys presentation privacy and prevents autonomous verification by standard third-party relying parties.
*(Note: This rejection specifically applies to synchronous in-band verification callbacks. In general enterprise integration, asynchronous event-driven webhooks remain a standard pattern—though the current `apps/issuer` prototype does not yet implement inbound SIS webhook adapters and operates via direct REST endpoints and the portal).*

### Option 3: Delegate to Off-the-Shelf Standard Verifier (`walt.id`)

* Good, because it aligns with real-world decentralized identity deployment models.
* Good, because it guarantees that UniDipVeri credentials interoperate with standard OID4VP 1.0 Final verifiers without special-case institutional adaptations.
* Good, because `@unidipveri/playground` and `scripts/issuer-verifier.interop.test.ts` provide clear reference integrations for how relying parties configure DCQL queries and verification policies.
* Bad, because testing requires the Walt.id container image to be available locally or in CI environments.

## Links

* [Problem and Threat Model](../architecture/01-problem-and-threat-model.md)
* [Playground Showcase Source](../../apps/playground/src/server.ts)
* [Automated Interoperability Test Suite](../../scripts/issuer-verifier.interop.test.ts)
* [Docker Compose Configuration](../../docker-compose.yml)
