# Activity Diagrams — UniDipVeri

**Version:** 0.1.0

Companion to `docs/01-requirements/SRS.md`, `docs/01-requirements/Use_Cases.md`, and `docs/02-analysis/DFD.md`. Where the DFD shows data at rest and in motion, these diagrams show control flow and decision points over time for the workflows that matter most to the thesis's central contribution (the eligibility-gated, approval-gated issuance pipeline), its user and wallet foundation, and its payoff (public verification). Swimlanes are actors/system components; diamonds are decisions; each diagram is traced back to the use case(s) and requirement(s) it implements.

---

## 1. Import Academic Record → Wallet Provisioning & Eligibility Evaluation

**Traces to:** UC-03, UC-05, UC-21 · FR-STU-01–03, FR-ELIG-01–08, FR-WAL-01, AS-01

```mermaid
flowchart TD
    subgraph Source["Academic Record Source"]
        A1([Start: has updated record])
        A2[Submit record payload]
    end

    subgraph Sys["UniDipVeri — Academic Record Adapter / Wallet / Eligibility Services"]
        B1{Program ID known?}
        B2[Reject import;\nnotify source]
        B3[Create/update STUDENT\n& ACADEMIC_RECORD]
        B4[Log import event]
        BW1{Student has active\nwallet_id?}
        BW2[Call walt.id Wallet API\nprovision server wallet]
        BW3{Wallet provision\nsucceeds?}
        BW4[Set wallet_status = ACTIVE;\nsave wallet_id]
        BW5[Set wallet_status = FAILED;\nlog warning]
        B5[Trigger eligibility evaluation]
        B6[Load active rule set\nfor program]
        B7{All mandatory\nrules satisfied?}
        B8[Record ELIGIBLE]
        B9[Record NOT_ELIGIBLE +\nfailed requirements list]
        B10[Log evaluation event]
    end

    subgraph Reg["Registrar"]
        C1[View student record,\nwallet status & eligibility]
        C2([End])
    end

    A1 --> A2 --> B1
    B1 -- no --> B2 --> A1
    B1 -- yes --> B3 --> B4 --> BW1
    BW1 -- yes --> B5
    BW1 -- no --> BW2 --> BW3
    BW3 -- yes --> BW4 --> B5
    BW3 -- no --> BW5 --> B5
    B5 --> B6 --> B7
    B7 -- yes --> B8 --> B10
    B7 -- no --> B9 --> B10
    B10 --> C1 --> C2
```

**Notes**

- This flow can also start from **Registrar → manual re-evaluate** (UC-05 primary actor note); in that case the swimlane entry point is `B6` directly, skipping `A1`–`B5`.
- `B9`'s failed-requirements list is what US-D2 / FR-ELIG-09 surfaces to the Registrar in `C1`.
- `BW2`–`BW5` provisions the server-managed custodial wallet identity automatically without blocking the import if walt.id is transiently unreachable.

---

## 2. Credential Issuance Request → Approval → Issuance

**Traces to:** UC-07, UC-08, UC-09, UC-10, UC-21 · FR-APPR-01–10, FR-CRED-01–06, FR-WAL-04

```mermaid
flowchart TD
    subgraph Reg["Registrar"]
        A1([Start: wants to issue\na diploma for a student])
        A2[Select student, initiate request]
        A9([End: request refused])
    end

    subgraph Sys["UniDipVeri — Approval / Credential Services"]
        B1{Latest evaluation\n= ELIGIBLE?}
        B2[Show failed requirements]
        BW{Student wallet_status\n= ACTIVE?}
        BWFail[Refuse: wallet not ready;\nprompt to retry wallet]
        B3{Active/issued request\nalready exists for this\nstudent + credential type?}
        B4[Refuse: duplicate]
        B5[Create request\nPENDING_APPROVAL,\nlinked to evaluation]
        B6[Add to Approver queue]
        C1{Decision received}
        C2[Record decision,\nactor, timestamp]
        C3{Same approver already\nvoted on this request?}
        C4[Ignore — does not\ncount twice]
        C5{Decision = APPROVE?}
        C6[Set REJECTED]
        C7[Count distinct approvals]
        C8{Approvals ≥\nrequired policy count?}
        C9[Wait for more approvals]
        D1[Load schema; build\ncredential subject]
        D2[Call VC Adapter → issue\ninto student wallet_id]
        D3{walt.id call\nsucceeds?}
        D4[Log failure;\nrequest stays in last\napproved state; retryable]
        D5[Store CREDENTIAL VALID;\nmark request ISSUED]
        D6([End: no credential issued])
    end

    subgraph App["Approver"]
        E1[Open pending queue]
        E2[Review request]
        E3[Approve\noptional comment]
        E4[Reject\nwith reason]
    end

    subgraph Stu["Student"]
        F1([End: credential\nvisible in portal])
    end

    A1 --> A2 --> B1
    B1 -- no --> B2 --> A9
    B1 -- yes --> BW
    BW -- no --> BWFail --> A9
    BW -- yes --> B3
    B3 -- yes --> B4 --> A9
    B3 -- no --> B5 --> B6 --> E1
    E1 --> E2
    E2 --> E3
    E2 --> E4
    E3 --> C1
    E4 --> C1
    C1 --> C3
    C3 -- yes, duplicate vote --> C4 --> E1
    C3 -- no --> C2
    C2 --> C5
    C5 -- no (reject) --> C6 --> D6
    C5 -- yes (approve) --> C7 --> C8
    C8 -- no --> C9 --> E1
    C8 -- yes --> D1 --> D2 --> D3
    D3 -- no --> D4 --> C9
    D3 -- yes --> D5 --> F1
```

**Notes**

- `BW` enforces FR-WAL-04: an active custodial wallet must be provisioned before issuance can proceed.
- `C4` implements FR-APPR-09 (no double-counting the same approver).
- `D3`/`D4` implements UC-10's extension: a failed walt.id call does not corrupt request state — it stays at "fully approved, not yet issued" and can be retried.
- The MVP policy (`B8`/`C8` threshold) is N = 1, but the flow is drawn generically since N is Admin-configurable (FR-APPR-10, US-E5).

---

## 3. Credential Revocation → Reissuance

**Traces to:** UC-15, UC-16 · FR-CRED-09–13, FR-ELIG-10

```mermaid
flowchart TD
    subgraph Reg["Registrar"]
        A1([Start: credential\nneeds correction/invalidation])
        A2[Select credential,\nprovide reason]
        A3{Reissue needed?}
        A4[Initiate reissuance]
        A9([End: revoked,\nno reissuance])
    end

    subgraph Sys["UniDipVeri"]
        B1[Call walt.id to\nupdate VC status]
        B2[Set CREDENTIAL = REVOKED;\nrecord reason, actor, timestamp]
        B3[Log revocation event]
        B4[Re-run eligibility\nevaluation for student]
        B5{Result = ELIGIBLE?}
        B6[Cannot proceed]
        B7[Create new\nCREDENTIAL_ISSUANCE_REQUEST\nwith supersedesCredentialId]
    end

    subgraph Approve["Approval & Issuance\n(see Diagram 2)"]
        C1[[Request enters\nPENDING_APPROVAL →\nfull approval workflow]]
        C2[New CREDENTIAL VALID,\nreferences superseded credential]
    end

    A1 --> A2 --> B1 --> B2 --> B3 --> A3
    A3 -- no --> A9
    A3 -- yes --> A4 --> B4 --> B5
    B5 -- no --> B6 --> A9
    B5 -- yes --> B7 --> C1 --> C2
```

**Notes**

- `B4`/`B5` is the enforcement point for FR-ELIG-10 and the reissuance extension in UC-16: a student's _past_ eligibility never carries over automatically — reissuance is treated as a brand-new issuance request, re-evaluated and re-approved from scratch (folds into Diagram 2 at `C1`).

---

## 4. Share Creation → Public Verification

**Traces to:** UC-11, UC-12, UC-13, UC-14 · FR-SHARE-01–07, FR-VER-01–08, NFR-02, NFR-07

```mermaid
flowchart TD
    subgraph Stu["Student"]
        A1([Start: wants to prove\na diploma to a third party])
        A2[Log in; open\ncredential list]
        A3{Credential status\n= VALID?}
        A4[Cannot share]
        A5[Set expiry\n+ optional purpose]
        A6[Receive opaque\npublic URL]
        A7[Send link to\nemployer / third party]
        A8{Wants to revoke\nlater?}
        A9[Revoke share]
        A10([End: share inactive])
    end

    subgraph SysShare["UniDipVeri — Share Service"]
        B1[Generate opaque\nshare token]
        B2[Store SHARE record\nwith expiry]
        B3[Mark share revoked]
    end

    subgraph Ver["Verifier (anonymous)"]
        V1([Start: has share link])
        V2[Open URL —\nno account needed]
    end

    subgraph SysVerify["UniDipVeri — Verification Service"]
        C1{Share active\nand unexpired?}
        C2[Return EXPIRED_SHARE\nno credential details]
        C3[Load associated\ncredential]
        C4{Credential status\n= REVOKED?}
        C5[Return REVOKED]
        C6[Call walt.id verifier:\nissuer + integrity + status]
        C7{walt.id call\nsucceeds?}
        C8[Return VERIFICATION_ERROR]
        C9{Issuer/integrity\nconfirmed?}
        C10[Return UNKNOWN_ISSUER /\nINVALID_CREDENTIAL]
        C11[Return VERIFIED +\nplain-language summary\n— not raw VC]
        C12[Record VERIFICATION_EVENT\nregardless of outcome]
    end

    A1 --> A2 --> A3
    A3 -- no --> A4 --> A1
    A3 -- yes --> A5
    A5 --> B1 --> B2 --> A6 --> A7
    A7 --> A8
    A8 -- yes --> A9 --> B3 --> A10
    A8 -- no, later --> A10

    V1 --> V2 --> C1
    C1 -- no --> C2 --> C12
    C1 -- yes --> C3 --> C4
    C4 -- yes --> C5 --> C12
    C4 -- no --> C6 --> C7
    C7 -- no --> C8 --> C12
    C7 -- yes --> C9
    C9 -- no --> C10 --> C12
    C9 -- yes --> C11 --> C12
    C12 --> V2end2([Verifier sees result])
```

---

## 5. Staff User Management & Role Assignment

**Traces to:** UC-20 · FR-USER-01, FR-USER-02, FR-USER-03, FR-USER-05, FR-AUD-09

```mermaid
flowchart TD
    subgraph Admin["Platform Administrator"]
        A1([Start: manage staff users])
        A2{Action type}
        A3[Submit new user details\n& select role: REGISTRAR/APPROVER/ADMIN]
        A4[Select existing user\n& edit role/details]
        A5[Select existing user\n& request deactivation]
    end

    subgraph Sys["UniDipVeri — User Management Service"]
        B1{Email already\nregistered?}
        B2[Reject with\nconflict error]
        B3[Hash password;\nstore UNIVERSITY_STAFF ACTIVE]
        B4[Update user record\n& role permissions]
        B5{Is user last\nactive ADMIN?}
        B6[Reject: cannot deactivate\nlast Admin]
        B7[Set user status = INACTIVE;\ninvalidate active sessions]
        B8[Log user management\naudit event]
    end

    subgraph Result["Outcome"]
        C1([Success: user created])
        C2([Success: user updated])
        C3([Success: user deactivated])
        C4([Error reported])
    end

    A1 --> A2
    A2 -- Create user --> A3 --> B1
    B1 -- yes --> B2 --> C4
    B1 -- no --> B3 --> B8 --> C1

    A2 -- Update role/profile --> A4 --> B4 --> B8 --> C2

    A2 -- Deactivate user --> A5 --> B5
    B5 -- yes --> B6 --> C4
    B5 -- no --> B7 --> B8 --> C3
```

---

## 6. Student Wallet Provisioning & Retry

**Traces to:** UC-21, UC-22 · FR-WAL-01, FR-WAL-02, FR-WAL-03, FR-AUD-10

```mermaid
flowchart TD
    subgraph Trigger["Trigger"]
        T1([Record import completes\nor Staff clicks Retry Wallet])
    end

    subgraph Sys["UniDipVeri — Wallet Service"]
        W1[Check student wallet state]
        W2{Wallet already\nACTIVE?}
        W3([End: already active])
        W4[Set wallet_status = PENDING]
        W5[Call walt.id Wallet API\ncreate server-managed wallet]
        W6{walt.id response\nstatus 200/201?}
        W7[Extract wallet_id / DID;\nsave to STUDENT record;\nset wallet_status = ACTIVE]
        W8[Set wallet_status = FAILED;\nrecord failure detail]
        W9[Log wallet provisioning\naudit event]
    end

    subgraph Staff["Registrar / Admin UI"]
        S1([Status visible in Student List:\nACTIVE, PENDING, or FAILED])
    end

    T1 --> W1 --> W2
    W2 -- yes --> W3
    W2 -- no --> W4 --> W5 --> W6
    W6 -- yes --> W7 --> W9 --> S1
    W6 -- no --> W8 --> W9 --> S1
```

---

## 7. Diagram Cross-Reference

| Diagram                                | Use Cases                         | Key Requirements                               | Actors/Lanes                              |
| -------------------------------------- | --------------------------------- | ---------------------------------------------- | ----------------------------------------- |
| 1. Import → Wallet → Eligibility       | UC-03, UC-05, UC-21               | FR-STU-01–03, FR-ELIG-01–08, FR-WAL-01, AS-01  | Academic Record Source, System, Registrar |
| 2. Request → Approval → Issuance       | UC-07, UC-08, UC-09, UC-10, UC-21 | FR-APPR-01–10, FR-CRED-01–06, FR-WAL-04        | Registrar, System, Approver, Student      |
| 3. Revocation → Reissuance             | UC-15, UC-16                      | FR-CRED-09–13, FR-ELIG-10                      | Registrar, System, (folds into Diagram 2) |
| 4. Share → Verification                | UC-11, UC-12, UC-13, UC-14        | FR-SHARE-01–07, FR-VER-01–08, NFR-02, NFR-07   | Student, System, Verifier                 |
| 5. Staff User Management               | UC-20                             | FR-USER-01, FR-USER-02, FR-USER-03, FR-USER-05 | Platform Administrator, System            |
| 6. Student Wallet Provisioning & Retry | UC-21, UC-22                      | FR-WAL-01, FR-WAL-02, FR-WAL-03, FR-WAL-04     | System, Registrar, Platform Administrator |

Together, Diagrams 1–6 cover the full lifecycle and operational prerequisites end to end: _Staff Managed & Roles Assigned → Academic Record Imported → Student Wallet Provisioned → Eligibility Evaluated → (Eligible → Issuance Requested → Approved → Issued to Wallet) or (Not Eligible → No Issuance) → [Revoked → Reissued] → Shared → Verified._
