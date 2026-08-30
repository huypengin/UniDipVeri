# Data Model

**Version:** 0.2.0

Supports `docs/01-requirements/SRS.md` Section 7. Reflects four cumulative architectural elements:

1. **Single tenant.** `UNIVERSITY` is a singleton table (one row, seeded at deployment). No cross-university foreign keys exist anywhere else in the model.
2. **User management.** `UNIVERSITY_STAFF` tracks administrative staff accounts with explicit roles (`REGISTRAR | APPROVER | ADMIN`) and `status` (`ACTIVE | INACTIVE`) managed by Platform Administrators.
3. **Approval workflow.** Issuance goes through `CREDENTIAL_ISSUANCE_REQUEST` and `CREDENTIAL_APPROVAL` before a `CREDENTIAL` row is created, governed by `APPROVAL_POLICY`.
4. **Academic record import, student wallet & eligibility.** `STUDENT` and `ACADEMIC_RECORD` are populated from the external Academic Record Source. A server-managed custodial wallet (`wallet_id`, `wallet_status`) is provisioned on walt.id. Each `PROGRAM` carries a versioned `ELIGIBILITY_RULE_SET`, and a student's `ELIGIBILITY_EVALUATION` against that rule set gates whether a `CREDENTIAL_ISSUANCE_REQUEST` can even be created.

---

## 1. ERD

```mermaid
erDiagram

    UNIVERSITY ||--o{ UNIVERSITY_STAFF : employs
    UNIVERSITY ||--o{ PROGRAM : offers
    UNIVERSITY ||--o{ CREDENTIAL_SCHEMA : defines
    UNIVERSITY ||--|| APPROVAL_POLICY : configures

    PROGRAM ||--o{ STUDENT : enrolls
    PROGRAM ||--o{ ELIGIBILITY_RULE_SET : defines

    STUDENT ||--o{ ACADEMIC_RECORD : has
    STUDENT ||--o{ ELIGIBILITY_EVALUATION : evaluated_for
    ELIGIBILITY_RULE_SET ||--o{ ELIGIBILITY_EVALUATION : evaluated_against

    STUDENT ||--o{ CREDENTIAL_ISSUANCE_REQUEST : requests
    ELIGIBILITY_EVALUATION ||--o| CREDENTIAL_ISSUANCE_REQUEST : justifies

    CREDENTIAL_SCHEMA ||--o{ CREDENTIAL_ISSUANCE_REQUEST : describes

    CREDENTIAL_ISSUANCE_REQUEST ||--o{ CREDENTIAL_APPROVAL : receives
    CREDENTIAL_ISSUANCE_REQUEST ||--o| CREDENTIAL : produces

    CREDENTIAL ||--o{ SHARE : has
    CREDENTIAL ||--o{ CREDENTIAL : supersedes

    SHARE ||--o{ VERIFICATION_EVENT : generates

    UNIVERSITY {
        uuid id PK
        string name
        string code
        string issuer_id
        string status
        datetime created_at
    }

    UNIVERSITY_STAFF {
        uuid id PK
        uuid university_id FK
        string name
        string email
        string password_hash
        string role "REGISTRAR | APPROVER | ADMIN"
        string status "ACTIVE | INACTIVE"
        datetime created_at
        datetime updated_at
    }

    PROGRAM {
        uuid id PK
        uuid university_id FK
        string name
        string degree_level
        string status
    }

    ELIGIBILITY_RULE_SET {
        uuid id PK
        uuid program_id FK
        int version
        json rules "e.g. MIN_CREDITS, MIN_GPA, REQUIRED_COURSE entries"
        datetime created_at
        uuid created_by FK "UNIVERSITY_STAFF.id"
    }

    STUDENT {
        uuid id PK
        uuid program_id FK
        string student_number
        string name
        string email
        string status "ACTIVE | GRADUATED | INACTIVE"
        string source_record_ref "identifier from Academic Record Source"
        string wallet_id "walt.id server-managed wallet identity"
        string wallet_status "PENDING | ACTIVE | FAILED"
        datetime imported_at
        datetime updated_at
    }

    ACADEMIC_RECORD {
        uuid id PK
        uuid student_id FK
        int credits_completed
        decimal gpa
        json completed_courses
        datetime source_snapshot_at "timestamp asserted by the source system"
        datetime imported_at
    }

    ELIGIBILITY_EVALUATION {
        uuid id PK
        uuid student_id FK
        uuid rule_set_id FK
        string result "ELIGIBLE | NOT_ELIGIBLE"
        json failed_requirements "populated when NOT_ELIGIBLE"
        datetime evaluated_at
    }

    CREDENTIAL_SCHEMA {
        uuid id PK
        uuid university_id FK
        string name
        string version
        string credential_type
        string schema_uri "references preconfigured walt.id profile (e.g. AcademicDiploma_jwt_vc_json)"
        datetime created_at
    }

    APPROVAL_POLICY {
        uuid id PK
        uuid university_id FK
        int required_approvals "MVP default = 1"
        datetime updated_at
    }

    CREDENTIAL_ISSUANCE_REQUEST {
        uuid id PK
        uuid student_id FK
        uuid program_id FK
        uuid schema_id FK
        uuid eligibility_evaluation_id FK "must reference an ELIGIBLE result"
        uuid requested_by FK "UNIVERSITY_STAFF.id"
        uuid supersedes_credential_id FK "nullable, set for reissuance"
        string status "PENDING_APPROVAL | APPROVED | REJECTED | ISSUED"
        datetime created_at
        datetime decided_at
    }

    CREDENTIAL_APPROVAL {
        uuid id PK
        uuid request_id FK
        uuid approver_id FK "UNIVERSITY_STAFF.id"
        string decision "APPROVE | REJECT"
        string comment
        datetime decided_at
    }

    CREDENTIAL {
        uuid id PK
        uuid request_id FK "the request that produced this credential"
        uuid student_id FK
        uuid program_id FK
        uuid schema_id FK
        uuid supersedes_id FK
        string credential_type
        string vc_reference "walt.id Wallet API entry id (custodial) — not the raw VC document, see Architecture_Design.md §3a"
        string status "VALID | REVOKED"
        datetime issued_at
        datetime revoked_at
        string revocation_reason
    }

    SHARE {
        uuid id PK
        uuid credential_id FK
        string token_hash
        string purpose
        datetime created_at
        datetime expires_at
        datetime revoked_at
    }

    VERIFICATION_EVENT {
        uuid id PK
        uuid share_id FK
        datetime verified_at
        string result
        string verifier_context
        string ip_hash
    }
```

## 2. Notes on Entity Semantics & Lifecycle

- **`UNIVERSITY_STAFF` management:** Platform Administrators manage staff rows. Deactivation sets `status = INACTIVE` without deleting historical references in `CREDENTIAL_APPROVAL`, `CREDENTIAL_ISSUANCE_REQUEST`, or `ELIGIBILITY_RULE_SET`.
- **`STUDENT` and `ACADEMIC_RECORD` are import-only tables.** There is no Registrar-facing manual "create student" write path (see `API_Specification.md` Section 4) — every row traces back to a `source_record_ref` from the Academic Record Source, making AS-01 ("source data trusted as correct") an enforceable data-layer boundary. `ACADEMIC_RECORD` keeps `source_snapshot_at` separate from `imported_at` so the model distinguishes "when the source system asserted this was true" from "when UniDipVeri received it."
- **Student Wallet lifecycle:** Each `STUDENT` carries `wallet_id` and `wallet_status` (`PENDING | ACTIVE | FAILED`). When imported, the system calls walt.id's Wallet API to provision a server-managed custodial wallet. Credential issuance requires `wallet_status = ACTIVE`.
- **`CREDENTIAL` has no expiration field by design.** `status` is intentionally two-state (`VALID | REVOKED`) with no `expires_at` column and no `EXPIRED` value — an issued diploma does not lapse over time; only an explicit revocation (`CREDENTIAL.revoked_at`, `revocation_reason`) invalidates it. This is distinct from `SHARE.expires_at`, which governs how long a *share link* stays usable, not the credential's own validity. See SRS AS-06 and `Architecture_Design.md` §7 for the rationale.
- **`CREDENTIAL_SCHEMA` and walt.id Profile Binding:** `CREDENTIAL_SCHEMA.schema_uri` holds the identifier of the preconfigured profile defined in walt.id's `issuer2-profiles.conf` (e.g. `AcademicDiploma_jwt_vc_json`). UniDipVeri does not generate or push cryptographic schemas into walt.id dynamically at runtime; it passes this preconfigured identifier during the OID4VCI issuance call (`WaltIdVCAdapter`).
- **`ELIGIBILITY_RULE_SET` is versioned per program**, and `ELIGIBILITY_EVALUATION` stores a foreign key to the specific version it ran against (not just to `PROGRAM`). This directly implements FR-ELIG-10: editing a program's rules later does not retroactively change what an old evaluation (or a credential issued off it) meant.
- **`CREDENTIAL_ISSUANCE_REQUEST.eligibility_evaluation_id` is a hard link, not just an audit trail entry.** The application layer must reject request creation (`API_Specification.md` Section 6) unless this links to an evaluation whose `result = ELIGIBLE`.
- **Full NFR-06 traceability chain:** `UNIVERSITY_STAFF` (configured) → `ACADEMIC_RECORD` (imported) → `STUDENT.wallet_id` (provisioned) → `ELIGIBILITY_EVALUATION` (computed) → `CREDENTIAL_ISSUANCE_REQUEST` (created only if eligible) → `CREDENTIAL_APPROVAL` (one or more) → `CREDENTIAL` (issued). Every arrow is a foreign key, so the chain is reconstructable with database joins alone.

## 3. Application-Level Credential Representation

The schema referenced by `CREDENTIAL_SCHEMA` (`MIUAcademicDiplomaCredential/v1`, binding to `AcademicDiploma_jwt_vc_json` in walt.id):

```mermaid
flowchart TD
    Root["AcademicDiplomaCredential"]

    Root --> Issuer["issuer"]
    Issuer --> IssuerId["id"]
    Issuer --> IssuerName["name"]

    Root --> Subject["credentialSubject"]
    Subject --> SubId["id"]
    Subject --> SubName["name"]
    Subject --> SubStudentNumber["studentNumber"]
    Subject --> SubDegree["degree"]
    Subject --> SubProgram["program"]
    Subject --> SubDegreeLevel["degreeLevel"]
    Subject --> SubAwardDate["awardDate"]

    Root --> Status["credentialStatus"]
```

```json
{
    "credentialType": "AcademicDiploma",
    "schemaVersion": "1.0",
    "issuer": "Mekong International University",
    "subject": {
        "name": "Nguyen Minh Anh",
        "studentNumber": "MIU2026-001",
        "degree": "Bachelor of Computer Science",
        "program": "Computer Science",
        "degreeLevel": "Bachelor",
        "awardDate": "2026-06-15"
    }
}
```

Note what is deliberately _not_ in this payload: `ACADEMIC_RECORD` details (GPA, course list) and `ELIGIBILITY_EVALUATION` results. Those justify _why_ the credential was issued but are not part of the credential subject itself and are never sent to walt.id or exposed on the public verification page (SRS NFR-02, NFR-07).
