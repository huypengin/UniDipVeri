# 0002: Enforce CSPRNG Salting over Unsalted Claim Hashing

* Status: accepted
* Date: 2026-10-06

## Context and Problem Statement

In academic credentials, many high-value attributes exhibit extremely low information entropy. For example:
* Cumulative GPA typically ranges between 2.00 and 4.00 in 0.01 increments (only 201 possible values).
* Birth year for graduating students typically spans a 30-year window (30 possible values).
* Degree programs at an institution number in the dozens or low hundreds.

Legacy academic credential systems (such as IU-VC) operated at the whole-document level, anchoring entire PDF papers or certificate components into Merkle trees and lacking fine-grained field-level selective disclosure. When transitioning to field-level selective disclosure for individual academic attributes (e.g. GPA, birth date, letter grades), attributes have extremely low information entropy. A naive unsalted claim hashing approach (`SHA-256(canonicalString(value))`) would allow an adversary or relying party to precompute dictionary tables of all possible GPA values in less than a millisecond, completely breaking selective disclosure confidentiality.

How should UniDipVeri blind concealed claims to guarantee cryptographic preimage resistance against dictionary and brute-force attacks?

## Decision Drivers

* **Cryptographic Preimage Hardness:** An adversary observing undisclosed claim digests must not be able to guess, brute-force, or infer the concealed values.
* **Standard Conformance:** The mechanism must strictly comply with RFC 9901 salt requirements.
* **Verification Simplicity:** Verifiers must be able to verify disclosure digests without requiring complex interactive Zero-Knowledge Proof (ZKP) verification engines.

## Considered Options

* **Option 1:** RFC 9901 Cryptographically Secure Pseudorandom Number Generator (CSPRNG) salting with ≥ 128 bits of entropy.
* **Option 2:** Naive unsalted claim hashing (naive baseline).
* **Option 3:** Zero-Knowledge Proof blinding factors (e.g., Groth16 / Circom or BBS+ signatures).

## Decision Outcome

Chosen option: **Option 1**, because generating a ≥ 128-bit random salt per claim under RFC 9901 expands the preimage search space to 2¹²⁸, making dictionary and rainbow-table attacks computationally infeasible while avoiding the computational overhead and complex tooling of ZKPs.

### Positive Consequences

* Concealed claims achieve full information-theoretic privacy against offline dictionary attacks.
* Verifiers only need standard SHA-256 / SHA-384 hashing to verify disclosures without specialized cryptographic proof libraries.
* Conforms directly to RFC 9901 and interoperates with standard off-the-shelf wallets and third-party verifiers.
* Empirically validated by test harness [`packages/core/tests/security-salting.test.ts`](../../packages/core/tests/security-salting.test.ts).

### Negative Consequences

* Each disclosable claim increases payload size by the base64url-encoded salt length (minimum 16 bytes raw, 22 bytes base64url).
* Issuers must have access to a cryptographically secure random number source (`crypto.getRandomValues`).

## Pros and Cons of the Options

### Option 1: RFC 9901 CSPRNG Salting (≥ 128 bits)

* Good, because 2¹²⁸ preimage search space renders offline dictionary attacks impossible even for 1-bit or low-entropy claims.
* Good, because standard hash verification is executed in microseconds on any platform.
* Good, because it is an approved Internet standard.
* Bad, because it introduces a small byte overhead per disclosable claim.

### Option 2: Naive Unsalted Claim Hashing (Naive Baseline)

* Good, because it requires zero extra bytes for salt storage.
* Bad, because it provides zero cryptographic confidentiality for low-entropy academic attributes (GPA cracked in < 1 ms).
* Bad, because it gives users a false sense of privacy.

### Option 3: Zero-Knowledge Blinding (Groth16 / Circom / BBS+)

* Good, because it permits range proofs (e.g., proving GPA ≥ 3.0 without revealing exact value).
* Bad, because proof generation on mobile devices introduces multi-second delays and battery drain.
* Bad, because ecosystem adoption of pairing-friendly elliptic curves and ZKP credential formats is immature and fragmented.

## Links

* [Problem and Threat Model](../architecture/01-problem-and-threat-model.md)
* [Salting Implementation](../../packages/core/src/sd-jwt/salt.ts)
* [Empirical Security Test Suite](../../packages/core/tests/security-salting.test.ts)
