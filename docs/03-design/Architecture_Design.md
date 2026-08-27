# Architecture & Design

**Version:** 2.0

This document contains architectural and design decisions that support the requirements in `docs/01-requirements/SRS.md` (v2.0). It is not part of the SRS: it describes _how_ the system is built, not _what_ it must do.

**Updated for v2.0:** the SRS now models academic records as arriving from an external, trusted Academic Record Source, and inserts a graduation-eligibility evaluation step before a credential can be requested. This document adds the components that implement that.

---

## 1. Layered Architecture

```
Academic Record Source (external)
        │
        ▼
Academic Record Adapter ──▶ Eligibility Service
                                     │
                                     ▼
Frontend (3 portals)          Application REST API
   │                                │
   ▼                                ▼
Application REST API ──▶ Domain services (Eligibility, Approval, Credential, Share, Verify, Audit)
                                     │
                                     └── VC Infrastructure Adapter
                                                  │
                                                  ▼
                                               walt.id (Issuer + Wallet + Verifier)
```

The frontend never calls walt.id, or the Academic Record Source, directly. Two adapters bound the system: the **Academic Record Adapter** (inbound, trusted external data) and the **VC Infrastructure Adapter** (outbound, cryptographic operations). Everything between them is domain logic the thesis owns.

## 2. Academic Record Adapter & Eligibility Service (new)

```
AcademicRecordAdapter
├── importRecord(sourcePayload)     // normalizes source data into STUDENT / ACADEMIC_RECORD
└── getRecord(studentId)

EligibilityService
├── evaluate(studentId, programId)  // applies ELIGIBILITY_RULE set to ACADEMIC_RECORD
└── getLatestEvaluation(studentId, programId)
```

Design intent:

- **`AcademicRecordAdapter` is the only component allowed to write `STUDENT`/`ACADEMIC_RECORD` data.** The Registrar portal is read-only over imported records (it can view them and trigger re-import/re-evaluation, but does not hand-author grades or credits) — this is what makes AS-01 ("source records are trusted as correct on import") an enforceable boundary rather than just a policy statement.
- **`EligibilityService` never touches walt.id.** It only reasons over `ACADEMIC_RECORD` + `ELIGIBILITY_RULE` and produces an `ELIGIBILITY_EVALUATION`. This keeps "is this student eligible" and "is this credential cryptographically valid" as two separably-testable concerns, matching SRS NFR-07's three-tier trust distinction.
- **Eligibility is evaluated, not imported.** The source system supplies raw records (grades, credits, courses); UniDipVeri computes `ELIGIBLE`/`NOT_ELIGIBLE` itself against configured rules (FR-ELIG-03–06), so the eligibility _decision_ is this system's own output and is auditable, even though the underlying _facts_ are trusted input.

## 3. VC Adapter (unchanged from v1)

```
Your application
       │
       ▼
VCService (interface)
       │
       ▼
WaltIdVCService (implementation)
       │
       ▼
walt.id REST API
```

```
VCService
├── issueCredential()
├── verifyCredential()
├── revokeCredential()
└── getCredentialStatus()
...
```

Not exposed as a public API endpoint. This is the seam where a different VC provider could be substituted.

## 3a. walt.id Integration Model (custody & protocol choice)

walt.id's Community Stack exposes issuance and verification only through the standard OID4VCI (issuance) and OID4VP (presentation/verification) protocols — there is no non-protocol shortcut. Both protocols are designed around a _holder-interactive_ exchange (a QR code or deep link, a wallet app opening, the holder tapping to consent). UniDipVeri's constraint is not "avoid these protocols" but "never surface their interactive steps to a human" — the backend completes both flows itself, automatically, against a **server-managed wallet identity** rather than a student-held wallet app. All of this happens exclusively through `WaltIdVCService` — never called by any frontend, and never requiring action from the student or verifier:

- **Wallet API (custodial, server-managed)** — each student is associated with a server-side wallet identity (`wallet_id`) provisioned by UniDipVeri, not chosen or installed by the student. There is no wallet app and no student-controlled identity to set up.
- **Issuer API + OID4VCI, driven server-side** — when `Domain services → Credential Management` completes an approved request, `WaltIdVCService` itself acts as the "holder" side of the OID4VCI exchange, using the student's `wallet_id` to accept the offered credential automatically. No QR code or wallet-app redirect ever reaches the student; "receiving" a credential requires zero student interaction. The resulting wallet entry's identifier is stored as `Credential.vc_reference` (Data_Model.md) — not the raw VC document. This is what makes SRS §2.6's "no custom wallet" constraint concrete: UniDipVeri builds no wallet UX because the OID4VCI holder role is played by the backend, not by the student.
- **Verifier API + OID4VP, driven server-side** — at verification time, the Verification Service resolves the incoming share token to the underlying `wallet_id`/`vc_reference`, then `WaltIdVCService` itself acts as both requesting party and (via the server-managed wallet) responding holder in the OID4VP exchange — i.e., it triggers and completes the presentation internally and reads back the result. The verifier's browser only ever talks to UniDipVeri's own `/api/public/shares/{token}/verify` endpoint (API_Specification.md §10); it never sees a wallet redirect, consent screen, or OID4VP authorization request directly.

**Why this still matches "issue-once, verify-anytime" (SRS §1.2).** Because the holder side of both protocols is played by UniDipVeri's own server-managed wallet rather than a student's device, neither the student nor their wallet needs to be online at issuance or verification time — the backend can complete the OID4VCI/OID4VP handshake whenever it needs to, on demand. This is also why the share-link UX (UC-12/UC-14) can stay a plain opaque token rather than an OID4VP authorization request URL: the protocol still runs, just entirely behind UniDipVeri's API boundary (NFR-05).

## 4. API-to-Infrastructure Mapping

| Application API                                                              | Infrastructure                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------------- |
| `POST /api/academic-records/import`                                          | Academic Record Source (inbound)                |
| `POST /api/students/{id}/eligibility/evaluate`                               | EligibilityService (internal, no external call) |
| `POST /api/credential-requests/{id}/issue` (internal, triggered on approval) | walt.id issuer                                  |
| `POST /api/credentials/{id}/revoke`                                          | walt.id status mechanism                        |
| `POST /api/public/shares/{token}/verify`                                     | walt.id verifier                                |
| `Credential.vc_reference`                                                    | walt.id credential reference                    |
| `CredentialSchema`                                                           | walt.id schema/configuration                    |

## 5. End-to-End Workflow (Design)

```
Academic Record Source → import → STUDENT / ACADEMIC_RECORD (trusted as correct)
        │
        ▼
EligibilityService.evaluate() → ELIGIBILITY_EVALUATION: ELIGIBLE | NOT_ELIGIBLE
        │
   ┌────┴─────────────┐
   ▼                   ▼
NOT_ELIGIBLE       ELIGIBLE
   │                   │
No request         Registrar may create
possible            CREDENTIAL_ISSUANCE_REQUEST → PENDING_APPROVAL
                        │
                        ▼
                 Approver(s) decide, per ApprovalPolicy.requiredApprovals (MVP = 1)
                        │
                   ┌────┴────┐
                   ▼         ▼
               APPROVED   REJECTED
                   │
                   ▼
           VCService.issueCredential()
                   │
                   ▼
           Credential.status = VALID
```

This is the traceability chain required by SRS NFR-06: _Academic Record Imported → Eligibility Evaluated → (Eligible → Issuance Requested → Approved → Issued) or (Not Eligible → No Issuance)_. Each arrow corresponds to a persisted, timestamped record (`ACADEMIC_RECORD`, `ELIGIBILITY_EVALUATION`, `CREDENTIAL_ISSUANCE_REQUEST`, `CREDENTIAL_APPROVAL`, `CREDENTIAL`), so the whole chain is reconstructable from the database without relying on a separate audit log being kept in sync.

The reissuance workflow after a revocation reuses this same chain — a reissuance request still requires a current `ELIGIBLE` evaluation, not just the historical fact that the student was once eligible (FR-ELIG-10: rule changes don't retroactively affect _already-issued_ credentials, but a reissuance is a new issuance and is re-evaluated).

## 6. System Boundary

```mermaid
flowchart TB

    Source["Academic Record Source (external)"]
    Registrar["Registrar"]
    Approver["Approver"]
    Student["Student"]
    Verifier["Employer / Verifier"]

    subgraph UDV["UniDipVeri Platform (single tenant)"]
        RecordAdapter["Academic Record Adapter"]

        UI1["University Portal"]
        UI2["Student Portal"]
        UI3["Public Verification Portal"]

        API["Application API"]

        Domain["Domain Services"]
        Eligibility["Eligibility Service"]
        Approval["Approval Workflow"]
        Share["Share Management"]
        Credential["Credential Management"]
        Verify["Verification Service"]
        Audit["Audit Service"]

        VCAdapter["VC Infrastructure Adapter"]
        DB[("Application Database")]
    end

    subgraph Walt["walt.id Infrastructure"]
        Issuer["VC Issuer"]
        Wallet["Wallet (custodial,\nserver-managed —\nno student wallet app)"]
        WaltVerifier["VC Verifier"]
    end

    Source --> RecordAdapter
    RecordAdapter --> DB
    RecordAdapter --> Eligibility

    Registrar --> UI1
    Approver --> UI1
    Student --> UI2
    Verifier --> UI3

    UI1 --> API
    UI2 --> API
    UI3 --> API

    API --> Domain
    Domain --> Eligibility
    Domain --> Approval
    Domain --> Credential
    Domain --> Share
    Domain --> Verify
    Domain --> Audit

    Eligibility --> DB
    Approval --> DB
    Credential --> DB
    Share --> DB
    Audit --> DB

    Credential --> VCAdapter
    Verify --> VCAdapter

    VCAdapter --> Issuer
    Issuer --> Wallet
    VCAdapter --> WaltVerifier
    WaltVerifier --> Wallet
```

## 7. Design Notes

- **Single tenant by design, not just by data.** `university_id` is not treated as a future multi-tenancy seam. If multi-tenancy is ever needed, it's a separate future project.
- **Three-tier trust boundary (updated).** The system now distinguishes three layers, matching NFR-07:
    1. _Source academic records_ — trusted as correct on import (AS-01); UniDipVeri does not re-authenticate them.
    2. _Eligibility determination_ — computed by UniDipVeri itself from those records against configured rules; this is a claim the system does make and is responsible for getting right.
    3. _Credential cryptographic status_ — issuer authenticity, integrity, and revocation status, delegated to and guaranteed by walt.id.
       A verifier's `VERIFIED` result only ever speaks to layer 3. It is not a re-statement of layer 1's or layer 2's truth, which is why FR-VER-08 keeps the raw VC out of the default UI and instead shows the plain-language, pre-scoped summary.
- **Eligibility as a first-class, versioned decision.** Because `ELIGIBLITY_RULE` sets can change over time, each `ELIGIBILITY_EVALUATION` stores which rule version it ran against, so past decisions remain explainable even after rules are edited (FR-ELIG-10).
- **Approval policy as data.** Unchanged from v1: `ApprovalPolicy.requiredApprovals` defaults to 1 but is configuration, not a constant.
- **Custody model.** Issued VCs are held in walt.id's server-side Wallet API on the university's behalf (see §3a), not in a student-controlled wallet. This is a deliberate simplification, not an oversight: it keeps "receiving" a credential a zero-interaction event for the student and keeps sharing/verification a server-mediated flow rather than a wallet-presentation protocol.
- **Import mechanism is intentionally unspecified beyond an adapter boundary.** The SRS does not mandate _how_ the Academic Record Source delivers data (batch file, webhook, pull API) — only that UniDipVeri treats whatever arrives through `AcademicRecordAdapter` as trusted input. `API_Specification.md` picks one concrete shape (a POST import endpoint) for the prototype; swapping it later shouldn't touch `EligibilityService` or anything downstream.

## 8. Thesis Contribution Boundary

**My contribution:** academic-record-to-eligibility pipeline, eligibility rule evaluation, issuance-with-approval workflow, credential lifecycle (issue/revoke/reissue), short-lived sharing, public verification UX, audit trail, evaluation.

**External Academic Record Source's contribution:** authoritative academic data (out of this project's build scope; assumed to exist and be correct).

**walt.id's contribution:** VC infrastructure, cryptographic issuance and verification mechanisms.

Freeze this scope. Do not add multi-university support, student-facing/holder-interactive OID4VP (see SRS §3.2 — distinct from the server-side OID4VCI/OID4VP already used internally per §3a), multi-step approval chains, or a real integration with a specific SIS during the MVP — put them under Future Work. The research question stays clean: _can a VC-based, eligibility-gated, approval-gated, short-lived self-service verification workflow make academic credential verification more convenient than the traditional manual process?_

## 9. Future Work

- **Batch academic record import.** For large graduating cohorts, the Academic Record Adapter could accept a file or array payload and process records in a loop, reusing the same per-record validation and eligibility-trigger logic (§2) — no change to EligibilityService or downstream layers.
- **Batch eligibility evaluation.** A cohort-wide "evaluate all students in program X" operation, implemented as a loop over the existing evaluate() call.
- **Batch approval.** A UI convenience for an Approver to approve multiple pending requests in one action. If built, each approval must still be recorded as a distinct, individually timestamped CREDENTIAL_APPROVAL row (FR-APPR-08, NFR-06) — batching the UI action must not batch the audit semantics.
