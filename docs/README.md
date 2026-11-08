# UniDipVeri Documentation and Architectural Records

This directory contains the technical documentation and architecture decision records for UniDipVeri, an academic credential system that supports selective disclosure using SD-JWT Verifiable Credentials.

The documentation describes the system architecture, key design decisions, implementation, and evaluation procedures to support future development and reproducibility of the research.

---

## Directory Overview

```
docs/
├── README.md               # Documentation directory index & benchmark summary tables
│
├── architecture/           # System design, threat models, and protocol profiles
│   ├── 01-problem-and-threat-model.md
│   ├── 02-standards-profile.md
│   ├── 03-system-architecture.md
│   ├── 04-schema-and-data-model.md
│   └── 05-operations-and-governance.md
│
└── adr/                    # Architecture Decision Records (MADR format)
    ├── 0001-isolate-schema-contract.md
    ├── 0002-enforce-csprng-salting.md
    ├── 0003-adopt-dcql-query-model.md
    ├── 0004-delegate-verification-to-external-verifier.md
    ├── 0005-use-token-status-list-revocation.md
    └── 0006-support-signing-algorithm-agility.md
```

---

## 1. Architecture Specifications (`docs/architecture/`)

These documents formalize the technical architecture, problem statement, threat model, and standard profiles implemented by UniDipVeri:

1. [**Problem and Threat Model**](architecture/01-problem-and-threat-model.md): Detailed audit and flaw taxonomy of legacy credential architectures (using IU-VC as motivating case study), covering unsalted claim digests, signature invalidation on claim omission, ad-hoc canonicalization, and Ethereum smart-contract latency.
2. [**Standards Profile**](architecture/02-standards-profile.md): Normative profile constraints across RFC 9901, `draft-ietf-oauth-sd-jwt-vc-19` (`typ: dc+sd-jwt`), OpenID4VCI 1.0 Final, OpenID4VP 1.0 Final (DCQL), and Token Status List `draft-ietf-oauth-status-list-21` (with explicit HAIP non-conformance boundaries).
3. [**System Architecture**](architecture/03-system-architecture.md): End-to-end dataflow, sequence diagrams, key management, session lifecycle, and security boundaries across Issuer (`apps/issuer`), mobile wallets, and external Relying Party verification (delegated to walt.id verifier with `apps/playground` showcase).
4. [**Schema and Data Model**](architecture/04-schema-and-data-model.md): Declarative YAML schema design, Zod boundary validations, selective disclosure policies, and recursive claim masking mechanics.
5. [**Operations and Governance**](architecture/05-operations-and-governance.md): Enterprise solution deployment topology, OpenID4VCI mass issuance architecture and holder-binding solutions, reference prototype (`apps/issuer`) vs. enterprise target gap analysis, dual-layer staff workflow, Principal degree conferral authority mapping, FIPS 140-2 Level 3 key custody, and verifier trust anchor boundaries.

---

## 2. Architecture Decision Records (`docs/adr/`)

We document technical decisions using the Markdown Any Decision Records (MADR) format. Each record articulates the context, problem statement, decision drivers, considered alternatives (including legacy IU-VC designs), the chosen outcome, and its consequences:

- [**ADR-0001: Isolate Schema Contract from Core Engine**](adr/0001-isolate-schema-contract.md)
- [**ADR-0002: Enforce CSPRNG Salting over Unsalted Claim Hashing**](adr/0002-enforce-csprng-salting.md)
- [**ADR-0003: Adopt DCQL Verifier-Driven Query Model over DIF PE**](adr/0003-adopt-dcql-query-model.md)
- [**ADR-0004: Delegate Verification to Off-the-Shelf Standard Verifier**](adr/0004-delegate-verification-to-external-verifier.md)
- [**ADR-0005: Use IETF Token Status List for Credential Revocation**](adr/0005-use-token-status-list-revocation.md)
- [**ADR-0006: Support Signing Algorithm Agility across ES256, EdDSA, and ES384**](adr/0006-support-signing-algorithm-agility.md)

---

## 3. Empirical Evaluation & Micro-Benchmarks

> [!NOTE]
> **Synthetic Micro-Benchmark Notice:** These experimental benchmarks are synthetic micro-benchmarks intended solely for relative performance comparisons, empirical verification, and research paper tables. They do not constitute an official standard conformance test suite, production stress test, or real-world network benchmark.

To ensure empirical reproducibility, UniDipVeri provides a benchmark runner:

```bash
bun run benchmark
```

This benchmark executes:
1. **Preimage resistance brute-force tests** comparing unsalted Merkle leaves against RFC 9901 CSPRNG salting.
2. **Cryptographic latency benchmarks** across supported signing algorithms (`ES256`, `EdDSA`, `ES384`).
3. **Payload wire size and redaction measurements** calculating exact selective disclosure byte savings.

### Benchmark Results (Paper Reference Tables)

#### Table 1: Preimage Resistance (Naive Unsalted Claim Hashing vs RFC 9901 CSPRNG Salting)
| Commit Scheme | Attribute Domain | Search Space | Time to Crack | Outcome |
| :--- | :--- | :--- | :--- | :--- |
| Naive Unsalted Claim Hashing | GPA (0.00-4.00) | 401 candidate values | < 1 ms (386 iter) | Vulnerable |
| Naive Unsalted Claim Hashing | Grade (A-F) | 11 candidate values | < 0.01 ms (1 iter) | Vulnerable |
| UniDipVeri (RFC 9901) | GPA (0.00-4.00) | 2¹²⁸ × 401 ≈ 1.36 × 10⁴¹ | > 10²³ years (0 / 10000 cracked) | Infeasible |

> [!NOTE]
> **Selective Disclosure Granularity Context:** Legacy systems like IU-VC operate at the coarse document level (anchoring entire PDF documents or academic paper components to a Merkle tree), meaning fine-grained field redaction is impossible without breaking document integrity. When implementing field-level selective disclosure, committing claims naively without random salts creates fatal dictionary vulnerabilities on low-entropy attributes. UniDipVeri enforces RFC 9901 CSPRNG salting (≥ 128 bits).

#### Table 2: Cryptographic Latency across Curves (50 Iterations)
| Algorithm | Curve / Family | Masking (ms) | JWS Sign (ms) | Total Issuance (ms) |
| :--- | :--- | :--- | :--- | :--- |
| ES256 | NIST P-256 | ~0.10 ms | ~0.18 ms | ~0.27 ms |
| EdDSA | Ed25519 | ~0.06 ms | ~0.15 ms | ~0.20 ms |
| ES384 | NIST P-384 | ~0.08 ms | ~1.05 ms | ~1.13 ms |

#### Table 3: Payload Size and Selective Disclosure Reduction
| Artifact | Size (bytes) | % of Full | Redaction Scope |
| :--- | :--- | :--- | :--- |
| Unmasked Plain JSON | 584 B | — | No selective disclosure |
| SD-JWT Masked Root | 645 B | 26% | Masked claims and digests |
| Full Presentation | 2494 B | 100% | All claims revealed |
| Selective (Degree Only) | 1129 B | 45% | Redacts GPA, birthdate, coursework (55% savings) |
| Selective (GPA Only) | 1029 B | 41% | Redacts diploma honors, birthdate (59% savings) |

---

## 4. Third-Party Interoperability Evidence

- **Mobile Wallets**: Commercial mobile wallet issuance and presentation (Paradym, Sphereon, Lissi) was tested over public HTTPS tunnels. See the authoritative [Tested Wallets table in root README](../README.md#tested-wallets).
- **Automated Verifier Suite**: An automated integration test suite (`scripts/issuer-verifier.interop.test.ts`) tests the UniDipVeri Issuer against an external Walt.id Verifier 2 container (`docker.io/waltid/verifier-api2:1.2.0`). The test script itself acts as the automated Holder (requesting credentials, filtering disclosures, and signing key-binding JWTs) to verify standards compliance without requiring manual mobile wallet interaction.
