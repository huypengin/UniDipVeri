# 0001: Isolate Schema Contract from Core Engine

* Status: accepted
* Date: 2026-09-29

## Context and Problem Statement

Legacy academic credential implementations (notably IU-VC) embedded university-specific fields directly into the credential issuance and verification source code. Hardcoded schema assumptions tightly coupled the cryptographic verification engine to a single university's data model, preventing reuse across different academic institutions, high schools, professional accreditors, or non-academic domains.

How should UniDipVeri structure credential data models to ensure the core cryptographic engine remains completely schema-agnostic and universally reusable?

## Decision Drivers

* **Reusability:** The core engine (`packages/core`) must be usable across any institutional domain without code modifications.
* **Declarative Safety:** Institutional schema definitions should be human-readable, auditable by university administrators, and strictly validated at application startup.
* **Path Independence:** No library code should infer schema file paths from process working directories or repository layout.
* **Separation of Concerns:** Cryptographic primitives (signing, salt generation, digest verification) must remain decoupled from business rules (e.g., degree requirements or GPA scales).

## Considered Options

* **Option 1:** Declarative external YAML configuration with Zod startup validation.
* **Option 2:** Hardcoded TypeScript schema interfaces within the core engine (IU-VC approach).
* **Option 3:** Pure JSON Schema / W3C JSON-LD Context documents resolved over the network at runtime.

## Decision Outcome

Chosen option: **Option 1**, because it provides strict compile-time and startup-time type safety via Zod, keeps the core engine purely schema-agnostic, and avoids brittle runtime network requests for schema interpretation.

### Positive Consequences

* `packages/core` contains zero university-specific fields and can be published as a generic SD-JWT VC engine.
* Schemas are validated fail-fast at startup via [`packages/core/src/schema/validator.ts`](../../packages/core/src/schema/validator.ts), preventing runtime misconfigurations.
* University institutions can define new credential types (e.g., micro-credentials, diplomas, transcripts) simply by adding declarative YAML files (such as [`schemas/graduation-record.v1.yaml`](../../schemas/graduation-record.v1.yaml)) without touching TypeScript code.

### Negative Consequences

* Requires application entry points (`apps/issuer`, test suites, or demonstration runners) to explicitly pass schema paths or loaded YAML strings to core functions.
* Schema authors must learn the YAML selective disclosure configuration format.

## Pros and Cons of the Options

### Option 1: Declarative External YAML with Zod Validation

* Good, because it isolates the core cryptographic engine from domain data models.
* Good, because Zod validates unknown keys, missing selective disclosure policies, and invalid formats before any issuance occurs.
* Good, because YAML is readable by non-programmer administrators and registrars.
* Bad, because changes to schema syntax require updating the Zod validator.

### Option 2: Hardcoded TypeScript Interfaces (IU-VC Approach)

* Good, because it offers direct TypeScript autocomplete without an external parsing step.
* Bad, because it tightly couples the software to a single university's academic structure.
* Bad, because supporting a new credential format requires modifying, recompiling, and redeploying the core engine.

### Option 3: Runtime Network JSON-LD Context Resolution

* Good, because it leverages existing W3C JSON-LD conventions.
* Bad, because network latency and remote schema server outages can cause credential issuance and verification failures.
* Bad, because complex JSON-LD processing historically introduces canonicalization and parsing vulnerabilities.

## Links

* [Schema and Data Model Specification](../architecture/04-schema-and-data-model.md)
* [Implementation Validator](../../packages/core/src/schema/validator.ts)
