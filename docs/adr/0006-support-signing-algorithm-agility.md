# 0006: Support Signing Algorithm Agility across ES256, EdDSA, and ES384

* Status: accepted
* Date: 2026-10-02

## Context and Problem Statement

Cryptographic systems that lock themselves into a single digital signature algorithm suffer from fragility. If a cryptographic curve is weakened, if institutional compliance requirements change (e.g., government mandates requiring Suite B / NSA Commercial National Security Algorithm Suite curves like P-384), or if partner wallets require specific algorithms, hardcoded crypto forces costly codebase refactoring.

Furthermore, different ecosystem environments mandate different default curves:
* **Government & Standards Frameworks:** Frequently recommend or mandate NIST P-256 (`ES256`) and P-384 (`ES384`).
* **European SSI / eIDAS 2.0:** Frequently utilizes Edwards Curve 25519 (`EdDSA`).

How should UniDipVeri architect key management, signing, and verification to achieve complete cryptographic algorithm agility without hand-rolling elliptic curve mathematics?

## Decision Drivers

* **Zero Hand-Rolled Crypto:** Cryptographic operations MUST use vetted, audited reference libraries (e.g., `jose`).
* **Configuration-Driven Agility:** Swapping signing algorithms must require only an environment variable or configuration change, not application code changes.
* **Ecosystem Compatibility:** Support the dominant asymmetric algorithms used by standard digital wallets and European identity frameworks.

## Considered Options

* **Option 1:** Algorithm agility supporting `ES256`, `EdDSA`, and `ES384` powered by `jose`.
* **Option 2:** Hardcode a single algorithm (e.g., `ES256` only).
* **Option 3:** Generic PKCS#11 Hardware Security Module (HSM) abstraction layer.

## Decision Outcome

Chosen option: **Option 1**, because leveraging `jose` allows UniDipVeri to support `ES256`, `EdDSA`, and `ES384` through unified `Signer` and `Verifier` callback contracts. All unit, integration, and security test suites are parameterized across all three algorithms (`["ES256", "EdDSA", "ES384"]`).

### Positive Consequences

* Swapping algorithms between `ES256`, `EdDSA`, and `ES384` is accomplished by updating the `SIGNING_ALGORITHM` environment configuration.
* All cryptographic operations rely on standard Web Crypto primitives (`SubtleCrypto`) under the hood.
* Parameterized test suites in `packages/core/tests/signing.test.ts` guarantee that any regression in curve handling is caught immediately.
* Guarantees broad interoperability across both NIST and Edwards curves without application code modifications.

### Negative Consequences

* Test suites must execute cryptographic tests against three algorithms, slightly increasing automated test suite runtimes.
* Key export and DID Document publishing must dynamically format JWKs based on curve type (e.g., `crv: "P-256"`, `crv: "Ed25519"`, `crv: "P-384"`).

## Pros and Cons of the Options

### Option 1: Algorithm Agility via `jose` (`ES256`, `EdDSA`, `ES384`)

* Good, because it prevents vendor and algorithm lock-in.
* Good, because `jose` is widely audited, production-proven, and actively maintained.
* Good, because it supports Web Crypto standard interfaces across Bun, Node, and browser runtimes.
* Bad, because managing multiple algorithm configurations requires strict validation gates at startup.

### Option 2: Hardcoded Single Algorithm (e.g., `ES256` Only)

* Good, because key management logic is minimal and simple.
* Bad, because it cannot interoperate with wallets that require `EdDSA`.
* Bad, because transitioning to high-security 384-bit curves requires extensive refactoring.

### Option 3: PKCS#11 HSM Provider Abstraction

* Good, because it enables direct integration with hardware security modules and cloud KMS.
* Bad, because PKCS#11 C-bindings introduce complex native dependencies and hinder pure TypeScript portability in local development environments.

## Links

* [Standards Profile](../architecture/02-standards-profile.md)
* [Signer Implementation](../../packages/core/src/signing/signer.ts)
* [Issuer KeyManager](../../apps/issuer/src/services/key-manager.ts)
* [Keypair Generator Helper Script](../../scripts/generate-key.ts)
