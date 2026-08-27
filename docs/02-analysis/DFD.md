# Data Flow Diagrams — UniDipVeri

**Version:** 2.0

Companion to `docs/01-requirements/SRS.md` (v2.0), `docs/01-requirements/Use_Cases.md`, `docs/03-design/Data_Model.md`, and `docs/03-design/Architecture_Design.md`. This document shows _what data moves where_, complementing the use cases (interaction detail) and the architecture doc (component/layering detail). Notation: external entities are rectangles, processes are rounded/circular nodes numbered `P<n>`, data stores are open-ended boxes numbered `D<n>`, and arrows are labeled data flows. It does not introduce any process, store, or flow that isn't implied by the SRS functional requirements.

---

## 1. Level 0 — Context Diagram

The whole system treated as a single process, showing only its boundary with external actors and systems.

```mermaid
flowchart LR
    Source(["Academic Record Source"])
    Registrar(["Registrar"])
    Approver(["Approver"])
    Admin(["Platform Administrator"])
    Student(["Student"])
    Verifier(["Verifier (anonymous)"])
    Walt(["walt.id (Issuer + Verifier)"])

    Sys(("0.0\nUniDipVeri"))

    Source -->|academic record payload| Sys
    Sys -->|import accepted/rejected| Source

    Registrar -->|credentials, program data, eligibility rules, issuance requests, revoke/reissue requests| Sys
    Sys -->|program list, eligibility results, request status, audit views| Registrar

    Approver -->|credentials, approve/reject decision| Sys
    Sys -->|pending request queue, decision confirmation| Approver

    Admin -->|credentials, approval policy config| Sys
    Sys -->|current policy| Admin

    Student -->|credentials, share request, share revoke| Sys
    Sys -->|credential list, share links, verification history| Student

    Verifier -->|share token| Sys
    Sys -->|verification result| Verifier

    Sys -->|issue / revoke / verify VC request| Walt
    Walt -->|VC reference, status, verification outcome| Sys
```

---

## 2. Level 1 — Major Processes

Decomposes `0.0 UniDipVeri` into its top-level functional processes (grouped per SRS §4) and the data stores each one reads or writes. Store numbering follows `Data_Model.md`'s entities.

```mermaid
flowchart TB
    %% External entities
    Source(["Academic Record Source"])
    Registrar(["Registrar"])
    Approver(["Approver"])
    Admin(["Platform Administrator"])
    Student(["Student"])
    Verifier(["Verifier"])
    Walt(["walt.id"])

    %% Processes
    P1(("P1\nAuthenticate &\nAuthorize"))
    P2(("P2\nManage Program &\nEligibility Rules"))
    P3(("P3\nImport Academic\nRecord"))
    P4(("P4\nEvaluate\nEligibility"))
    P5(("P5\nCreate Issuance\nRequest"))
    P6(("P6\nApprove / Reject\nRequest"))
    P7(("P7\nIssue Credential"))
    P8(("P8\nView Credential"))
    P9(("P9\nRevoke Credential"))
    P10(("P10\nReissue Credential"))
    P11(("P11\nManage Share"))
    P12(("P12\nVerify Credential"))
    P13(("P13\nRecord Audit Event"))

    %% Data stores
    D1[(D1 University /\nUniversityStaff)]
    D2[(D2 Program /\nEligibilityRuleSet)]
    D3[(D3 Student /\nAcademicRecord)]
    D4[(D4 EligibilityEvaluation)]
    D5[(D5 ApprovalPolicy)]
    D6[(D6 CredentialIssuanceRequest /\nCredentialApproval)]
    D7[(D7 Credential)]
    D8[(D8 Share)]
    D9[(D9 VerificationEvent)]

    %% Auth
    Registrar -->|credentials| P1
    Approver -->|credentials| P1
    Admin -->|credentials| P1
    Student -->|credentials| P1
    P1 <-->|staff/session lookup| D1

    %% Program & rules
    Registrar -->|program data, rule set| P2
    Admin -->|rule set| P2
    P2 <-->|program & rule-set records| D2

    %% Import & eligibility
    Source -->|record payload| P3
    P3 -->|create/update| D3
    P3 -->|trigger| P4
    Registrar -->|manual re-evaluate| P4
    P4 -->|read academic record| D3
    P4 -->|read active rule set| D2
    P4 -->|write evaluation| D4
    P4 -->|import/eval event| P13

    %% Issuance request
    Registrar -->|request issuance| P5
    P5 -->|read latest evaluation| D4
    P5 -->|check existing requests/credentials| D6
    P5 -->|read policy| D5
    P5 -->|write PENDING_APPROVAL| D6
    P5 -->|request-created event| P13

    %% Approval
    Approver -->|decision + comment/reason| P6
    P6 -->|read request & prior approvals| D6
    P6 -->|write approval/rejection| D6
    P6 -->|policy threshold| D5
    P6 -->|"trigger (threshold met)"| P7
    P6 -->|decision event| P13

    %% Issuance
    P7 -->|read request, schema| D6
    P7 -->|issue VC| Walt
    Walt -->|VC reference| P7
    P7 -->|write VALID credential| D7
    P7 -->|mark ISSUED| D6
    P7 -->|issuance event| P13

    %% Viewing
    Student -->|view credentials| P8
    P8 -->|read own credentials| D7

    %% Revoke
    Registrar -->|revoke + reason| P9
    P9 -->|update status| D7
    P9 -->|revoke VC status| Walt
    P9 -->|revocation event| P13

    %% Reissue
    Registrar -->|reissue request| P10
    P10 -->|read revoked credential| D7
    P10 -->|trigger re-evaluation| P4
    P10 -->|create linked request| D6

    %% Share
    Student -->|create/revoke share| P11
    P11 -->|read own credential| D7
    P11 -->|write share record| D8
    P11 -->|share event| P13

    %% Verify
    Verifier -->|share token| P12
    P12 -->|resolve token| D8
    P12 -->|read credential| D7
    P12 -->|verify VC| Walt
    Walt -->|issuer/status result| P12
    P12 -->|plain-language result| Verifier
    P12 -->|write verification event| D9
    P12 -->|verification event| P13

    %% Audit
    P13 -->|persist event| D3
    P13 -->|persist event| D4
    P13 -->|persist event| D6
    P13 -->|persist event| D7
    P13 -->|persist event| D8
    P13 -->|persist event| D9
    Registrar -->|view audit history| P13
    Student -->|view own history| P13
```

**Note on P13 (Record Audit Event):** per `Data_Model.md` §2, there is no separately-maintained audit log table — the traceability chain (NFR-06) is reconstructed by joining `D3`–`D9` directly. `P13` is shown as a logical process (every write above carries its own timestamp/actor) rather than a physical store of its own; `GET /api/audit/*` (API_Specification.md §11) reads across `D3`–`D9`, it does not read a `D10 AuditLog`.

---

## 3. Level 2 — Import → Eligibility Subsystem

Decomposes `P3` and `P4`, the trust-boundary-critical subsystem (AS-01, NFR-07 layer 1→2).

```mermaid
flowchart TB
    Source(["Academic Record Source"])
    Registrar(["Registrar"])

    P3_1(("P3.1\nValidate Payload\n(known program?)"))
    P3_2(("P3.2\nUpsert Student &\nAcademic Record"))
    P4_1(("P4.1\nLoad Record +\nActive Rule Set"))
    P4_2(("P4.2\nCheck Rules\n(credits, GPA, courses)"))
    P4_3(("P4.3\nRecord Result"))

    D2[(D2 Program /\nEligibilityRuleSet)]
    D3[(D3 Student /\nAcademicRecord)]
    D4[(D4 EligibilityEvaluation)]

    Source -->|record payload| P3_1
    P3_1 -->|program lookup| D2
    P3_1 -->|reject: unknown program| Source
    P3_1 -->|valid payload| P3_2
    P3_2 -->|create/update| D3
    P3_2 -->|trigger| P4_1

    Registrar -->|manual re-evaluate request| P4_1
    P4_1 -->|read record| D3
    P4_1 -->|read active rule-set version| D2
    P4_1 -->|record + rules| P4_2
    P4_2 -->|pass/fail per rule| P4_3
    P4_3 -->|ELIGIBLE or NOT_ELIGIBLE +\nfailed requirements| D4
```

---

## 4. Level 2 — Issuance Request → Approval → Credential Subsystem

Decomposes `P5`, `P6`, `P7` — the thesis's central workflow.

```mermaid
flowchart TB
    Registrar(["Registrar"])
    Approver(["Approver"])
    Walt(["walt.id Issuer"])

    P5_1(("P5.1\nCheck Latest\nEvaluation = ELIGIBLE"))
    P5_2(("P5.2\nCheck No Active\nDuplicate Request"))
    P5_3(("P5.3\nCreate Request\nPENDING_APPROVAL"))
    P6_1(("P6.1\nRecord\nApprove/Reject"))
    P6_2(("P6.2\nCount Distinct\nApprovals vs Policy"))
    P7_1(("P7.1\nBuild Credential\nSubject"))
    P7_2(("P7.2\nCall VC Adapter"))
    P7_3(("P7.3\nStore Credential\n(VALID) & Mark ISSUED"))

    D4[(D4 EligibilityEvaluation)]
    D5[(D5 ApprovalPolicy)]
    D6[(D6 CredentialIssuanceRequest /\nCredentialApproval)]
    D7[(D7 Credential)]

    Registrar -->|request issuance| P5_1
    P5_1 -->|read latest| D4
    P5_1 -->|NOT_ELIGIBLE: refuse + failed requirements| Registrar
    P5_1 -->|ELIGIBLE| P5_2
    P5_2 -->|check existing| D6
    P5_2 -->|duplicate: refuse| Registrar
    P5_2 -->|clear| P5_3
    P5_3 -->|write request, link evaluation| D6

    Approver -->|decision + comment/reason| P6_1
    P6_1 -->|prevent duplicate approver vote| D6
    P6_1 -->|write decision| D6
    P6_1 -->|REJECT: set REJECTED, stop| D6
    P6_1 -->|APPROVE| P6_2
    P6_2 -->|approvals so far| D6
    P6_2 -->|required count| D5
    P6_2 -->|"threshold not yet met: wait"| D6
    P6_2 -->|"threshold met: trigger issuance"| P7_1

    P7_1 -->|read request + student/program data| D6
    P7_1 -->|subject payload| P7_2
    P7_2 -->|issueCredential| Walt
    Walt -->|vc_reference| P7_2
    P7_2 -->|result| P7_3
    P7_3 -->|write CREDENTIAL VALID| D7
    P7_3 -->|mark request ISSUED| D6
```

---

## 5. Level 2 — Share → Public Verification Subsystem

Decomposes `P11` and `P12` — the public-facing, unauthenticated path (NFR-02, NFR-07 layer 3).

```mermaid
flowchart TB
    Student(["Student"])
    Verifier(["Verifier (anonymous)"])
    Walt(["walt.id Verifier"])

    P11_1(("P11.1\nCreate Share\n(opaque token, expiry)"))
    P11_2(("P11.2\nRevoke Share"))
    P12_1(("P12.1\nResolve Token\n(active? expired? revoked?)"))
    P12_2(("P12.2\nLoad Credential"))
    P12_3(("P12.3\nCall VC Verifier\n(issuer, integrity, status)"))
    P12_4(("P12.4\nMap to Plain-Language\nResult"))

    D7[(D7 Credential)]
    D8[(D8 Share)]
    D9[(D9 VerificationEvent)]

    Student -->|credential + expiry + purpose| P11_1
    P11_1 -->|check status = VALID| D7
    P11_1 -->|write token_hash, expiry| D8
    P11_1 -->|public URL| Student

    Student -->|revoke| P11_2
    P11_2 -->|set revoked_at| D8

    Verifier -->|share token| P12_1
    P12_1 -->|lookup| D8
    P12_1 -->|"expired/revoked: EXPIRED_SHARE"| P12_4
    P12_1 -->|active| P12_2
    P12_2 -->|read| D7
    P12_2 -->|"credential REVOKED: skip walt.id"| P12_4
    P12_2 -->|VALID| P12_3
    P12_3 -->|verifyCredential| Walt
    Walt -->|issuer/integrity/status| P12_3
    P12_3 -->|raw result| P12_4
    P12_4 -->|VERIFIED / REVOKED / EXPIRED_SHARE /\nUNKNOWN_ISSUER / INVALID_CREDENTIAL /\nVERIFICATION_ERROR| Verifier
    P12_4 -->|"write event (regardless of outcome)"| D9
```

---

## 6. Data Store Cross-Reference

| Store | Entity/Entities (Data_Model.md)                  | Written by                            | Read by                             |
| ----- | ------------------------------------------------ | ------------------------------------- | ----------------------------------- |
| D1    | UNIVERSITY, UNIVERSITY_STAFF                     | P1 (session/staff mgmt), Admin config | P1, P2, P6                          |
| D2    | PROGRAM, ELIGIBILITY_RULE_SET                    | P2                                    | P2, P3, P4, P5                      |
| D3    | STUDENT, ACADEMIC_RECORD                         | P3 only (import-only, see AS-01)      | P4, P8 (indirect), P13              |
| D4    | ELIGIBILITY_EVALUATION                           | P4                                    | P5, P6 (indirect), P10              |
| D5    | APPROVAL_POLICY                                  | Admin via P2-adjacent config process  | P6                                  |
| D6    | CREDENTIAL_ISSUANCE_REQUEST, CREDENTIAL_APPROVAL | P5, P6, P7                            | P5, P6, P7, P10, P13                |
| D7    | CREDENTIAL                                       | P7, P9, P10                           | P8, P9, P11, P12                    |
| D8    | SHARE                                            | P11                                   | P11, P12                            |
| D9    | VERIFICATION_EVENT                               | P12                                   | P13 (student/registrar audit views) |

This table is the DFD-side counterpart to the traceability chain in `Data_Model.md` §2 and SRS NFR-06: every data store here corresponds 1:1 to an ERD entity, and every write in §2–§5 above is one link in the chain _Academic Record Imported → Eligibility Evaluated → Issuance Requested → Approved → Issued (→ Revoked → Reissued) → Shared → Verified_.
