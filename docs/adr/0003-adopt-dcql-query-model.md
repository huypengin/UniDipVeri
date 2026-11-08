# 0003: Adopt DCQL Verifier-Driven Query Model over DIF PE

* Status: accepted
* Date: 2026-10-18

## Context and Problem Statement

Verifiable credential literature often envisions an idealized user interface where the credential holder toggles individual checkboxes for each attribute before sending a presentation. However, empirical testing of standard mobile digital wallets (e.g., Sphereon, Paradym, Lissi, Walt.id) reveals that production wallets do not implement granular claim-by-claim checkbox interfaces.

Instead, production OID4VP workflows are **verifier-driven**:
1. The relying party specifies the exact claims required to satisfy a verification policy.
2. The wallet evaluates the query, derives a presentation containing only the requested disclosures, and presents an all-or-nothing **Accept / Reject** prompt to the user.

Additionally, the OpenID Foundation finalized OpenID4VP 1.0, removing the legacy DIF Presentation Exchange specification (`presentation_definition`, `input_descriptors`, `limit_disclosure`) in favor of the Digital Credentials Query Language (DCQL).

How should UniDipVeri query and derive selective disclosures across issuer, wallet, and verifier implementations?

## Decision Drivers

* **Specification Currency:** Align with OpenID4VP 1.0 Final.
* **Real-World Interoperability:** Guarantee that credential presentations succeed against standard, unmodified third-party mobile wallets.
* **Deterministic Path Filtering:** Provide concise, unambiguous path-based claim selection (e.g., `["papers", "diploma", "degreeName"]`).

## Considered Options

* **Option 1:** OpenID4VP 1.0 Final DCQL queries with a verifier-driven Accept/Reject consent model.
* **Option 2:** DIF Presentation Exchange 2.0 (`presentation_definition` with JSONPath filter rules).
* **Option 3:** Proprietary custom REST query endpoints (IU-VC approach).

## Decision Outcome

Chosen option: **Option 1**, because DCQL is the ratified query standard in OpenID4VP 1.0 Final, dramatically simplifies query construction over DIF Presentation Exchange, and faithfully matches the actual UX capabilities of current digital wallets.

### Positive Consequences

* presentations cleanly interoperate with off-the-shelf mobile wallets conforming to OpenID4VP 1.0.
* Verifiers express credential requirements using clean path arrays (`claims: [{ path: ["papers", "transcript", "cumulativeGPA"] }]`). Relying party portals like [`apps/playground`](../../apps/playground/src/server.ts) can dynamically discover schema leaf claims (`/api/discovery`) and build queries for scenario presets (Diploma, Transcript & GPA, Student Identity, Full Academic Record) or custom claim sets.
* Mobile wallet implementations (and automated test harnesses like [`scripts/issuer-verifier.interop.test.ts`](../../scripts/issuer-verifier.interop.test.ts)) can deterministically filter stored disclosures against verifier queries without evaluating complex JSONPath expressions.

### Negative Consequences

* Presentations require verifiers to know the schema paths in advance.
* **No SQL-Style Predicate Filtering inside Array Objects:** DCQL paths only support static segment arrays (e.g. `["papers", "transcript", "courses", 0, "grade"]`). It cannot express relational or conditional queries targeting items by sub-property values (for example, `SELECT grade FROM courses WHERE code = "CS101"`). To evaluate a specific course or grade, either the entire `courses` array must be disclosed and inspected post-hoc by the verifier's policy engine, or the credential schema must flatten key academic fields into distinct object claims.
* **No Regex Pattern or Fuzzy Substring Matching:** DCQL value matching is limited to exact equality checks. It cannot express regex patterns or substring queries (for example, querying courses with a title containing `"Database"` instead of exact `"Database Systems"`), shifting fuzzy matching responsibilities to relying party application code after presentation.
* Legacy wallets that only support DIF Presentation Exchange Draft 20 cannot process DCQL queries without an adapter.

## Pros and Cons of the Options

### Option 1: DCQL (Digital Credentials Query Language)

* Good, because it is the official standard in OpenID4VP 1.0 Final.
* Good, because it uses native JSON array paths instead of error-prone JSONPath regex strings.
* Good, because it explicitly models the real-world Accept/Reject wallet consent barrier.
* Bad, because it lacks expressive relational query features (no SQL-style filtering inside arrays of objects or regex pattern matching on claim values).
* Bad, because it is relatively new, requiring recent wallet software versions.

### Option 2: DIF Presentation Exchange 2.0

* Good, because it was widely used in older OID4VP draft implementations.
* Bad, because it was officially superseded and removed from the finalized OpenID4VP 1.0 specification.
* Bad, because complex JSONPath expressions and `predicate` rules lead to interoperability mismatches across verifier engines.

### Option 3: Proprietary Query Webhooks (IU-VC Approach)

* Good, because it requires no adherence to external query specifications.
* Bad, because it prevents any standard mobile wallet from presenting credentials.
* Bad, because relying parties must integrate custom API endpoints for every university issuer.

## Links

* [Standards Profile](../architecture/02-standards-profile.md)
* [Playground Dynamic DCQL Query Builder](../../apps/playground/src/dcql.ts)
* [Playground Scenario Presets](../../apps/playground/src/presets.ts)
* [Playground Leaf Claims Discovery](../../apps/playground/src/discovery.ts)
* [Playground Server & Session Orchestrator](../../apps/playground/src/server.ts)
* [Automated Holder & Interoperability Test Suite](../../scripts/issuer-verifier.interop.test.ts)
