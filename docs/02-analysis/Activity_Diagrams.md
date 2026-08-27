# Activity Diagrams — UniDipVeri

**Version:** 2.0

Companion to `docs/01-requirements/SRS.md` (v2.0), `docs/01-requirements/Use_Cases.md`, and `docs/02-analysis/DFD.md`. Where the DFD shows data at rest and in motion, these diagrams show control flow and decision points over time for the workflows that matter most to the thesis's central contribution (the eligibility-gated, approval-gated issuance pipeline) and its payoff (public verification). Swimlanes are actors/system components; diamonds are decisions; each diagram is traced back to the use case(s) and requirement(s) it implements.

---

## 1. Import Academic Record → Eligibility Evaluation

**Traces to:** UC-03, UC-05 · FR-STU-01–03, FR-ELIG-01–08, AS-01

```mermaid
flowchart TD
    subgraph Source["Academic Record Source"]
        A1([Start: has updated record])
        A2[Submit record payload]
    end

    subgraph Sys["UniDipVeri — Academic Record Adapter / Eligibility Service"]
        B1{Program ID known?}
        B2[Reject import;\nnotify source]
        B3[Create/update STUDENT\n& ACADEMIC_RECORD]
        B4[Log import event]
        B5[Trigger eligibility evaluation]
        B6[Load active rule set\nfor program]
        B7{All mandatory\nrules satisfied?}
        B8[Record ELIGIBLE]
        B9[Record NOT_ELIGIBLE +\nfailed requirements list]
        B10[Log evaluation event]
    end

    subgraph Reg["Registrar"]
        C1[View eligibility result]
        C2([End])
    end

    A1 --> A2 --> B1
    B1 -- no --> B2 --> A1
    B1 -- yes --> B3 --> B4 --> B5 --> B6 --> B7
    B7 -- yes --> B8 --> B10
    B7 -- no --> B9 --> B10
    B10 --> C1 --> C2
```

**Notes**

- This flow can also start from **Registrar → manual re-evaluate** (UC-05 primary actor note); in that case the swimlane entry point is `B6` directly, skipping `A1`–`B5`.
- `B9`'s failed-requirements list is what US-D2 / FR-ELIG-09 surfaces to the Registrar in `C1`.

---

## 2. Credential Issuance Request → Approval → Issuance

**Traces to:** UC-07, UC-08, UC-09, UC-10 · FR-APPR-01–10, FR-CRED-01–06

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
        D2[Call VC Adapter → issue]
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
    B1 -- yes --> B3
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

**Notes**

- `C11` deliberately never claims to re-check academic performance (US-H4, NFR-07, AC-11) — it is scoped to layer-3 credential status only.
- A revoked _share_ (`C1` = no) and a revoked _credential_ (`C4` = yes) are distinguished internally but, per Use_Cases.md UC-14 extension 2b, a revoked share is surfaced to the verifier the same way as an expired one rather than leaking which case applied.
- `C12` fires on every branch — this is what backs FR-AUD-05 and US-I2 (student sees full verification-event history regardless of outcome).

---

## 5. Diagram Cross-Reference

| Diagram                          | Use Cases                  | Key Requirements                             | Actors/Lanes                              |
| -------------------------------- | -------------------------- | -------------------------------------------- | ----------------------------------------- |
| 1. Import → Eligibility          | UC-03, UC-05               | FR-STU-01–03, FR-ELIG-01–08, AS-01           | Academic Record Source, System, Registrar |
| 2. Request → Approval → Issuance | UC-07, UC-08, UC-09, UC-10 | FR-APPR-01–10, FR-CRED-01–06                 | Registrar, System, Approver, Student      |
| 3. Revocation → Reissuance       | UC-15, UC-16               | FR-CRED-09–13, FR-ELIG-10                    | Registrar, System, (folds into Diagram 2) |
| 4. Share → Verification          | UC-11, UC-12, UC-13, UC-14 | FR-SHARE-01–07, FR-VER-01–08, NFR-02, NFR-07 | Student, System, Verifier                 |

Together, Diagrams 1–4 cover the full NFR-06 traceability chain end to end: _Academic Record Imported → Eligibility Evaluated → (Eligible → Issuance Requested → Approved → Issued) or (Not Eligible → No Issuance) → [Revoked → Reissued] → Shared → Verified._
