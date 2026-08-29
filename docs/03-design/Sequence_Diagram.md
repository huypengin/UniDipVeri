# Sequence Diagrams — UniDipVeri

**Version:** 0.1.0

Companion to `docs/01-requirements/SRS.md`, `docs/01-requirements/Use_Cases.md`, `docs/02-analysis/DFD.md`, `docs/03-design/Architecture_Design.md`, and `docs/03-design/Class_Diagram.md`. Where the Activity Diagrams show control flow and decision points, these diagrams show **object interaction over time** — which layer calls which, in what order, and what each call returns — down to the Application Service, Repository Port, and Adapter names used in the class diagram. All diagrams are Mermaid `sequenceDiagram`s.

**Participant conventions used throughout:**

- `actor` blocks are human/external actors (Registrar, Approver, Admin, Student, Verifier, Academic Record Source).
- `Controller` participants are thin Presentation-layer classes (§6 of `Class_Diagram.md`).
- Application Service participants (`StaffService`, `StudentWalletService`, `AcademicRecordService`, `EligibilityService`, `IssuanceRequestService`, `CredentialService`, `ShareService`, `VerificationService`, `AuditService`) match §4 of `Class_Diagram.md`.
- Repository/Port participants (`IStaffRepository`, `IStudentRepository`, etc.) represent calls through the Application Port interface; the concrete `Postgres*Repository` implementation is what actually runs, per §5.
- `WaltIdWalletAdapter` and `WaltIdVCAdapter` represent calls through `IWalletAdapter`/`IVCAdapter` to the `walt.id` infrastructure.
- **`AuthService`** is a small cross-cutting Application Service (not shown as a bounded-area box in `Class_Diagram.md` §4, since it has no domain state of its own) that implements FR-AUTH-01–04 for both staff and student sessions. It is called by every controller's authorization check but is only drawn explicitly in Diagrams 1 and 2.

---

## 1. Staff Login

**Traces to:** UC-01 · FR-AUTH-01, FR-AUTH-02, FR-AUTH-04

```mermaid
sequenceDiagram
    actor Staff as Registrar / Approver / Admin
    participant SC as StaffController
    participant Auth as AuthService
    participant Repo as IStaffRepository

    Staff->>SC: POST /api/auth/login {email, password}
    SC->>Auth: authenticate(email, password)
    Auth->>Repo: findByEmail(email)
    Repo-->>Auth: UniversityStaff | null

    alt no account, or status = INACTIVE
        Auth-->>SC: AuthenticationError
        SC-->>Staff: 401 Unauthorized
    else account found and active
        Auth->>Auth: verifyPassword(password, passwordHash)
        alt password mismatch
            Auth-->>SC: AuthenticationError
            SC-->>Staff: 401 Unauthorized
        else match
            Auth->>Auth: issue session scoped to staff role(s)
            Auth-->>SC: SessionDTO
            SC-->>Staff: 200 OK + session token
        end
    end
```

**Note:** No session is created on any failure branch. Every subsequent staff request re-checks role via `Auth` independent of session validity (FR-AUTH-04) — see the `alt` blocks for privileged actions in later diagrams.

---

## 2. Student Login

**Traces to:** UC-02 · FR-AUTH-03, FR-STU-04

```mermaid
sequenceDiagram
    actor Student
    participant SC as StudentController
    participant Auth as AuthService
    participant Repo as IStudentRepository

    Student->>SC: POST /api/auth/login {email, password}
    SC->>Auth: authenticate(email, password)
    Auth->>Repo: findByEmail(email)
    Repo-->>Auth: Student | null

    alt no account
        Auth-->>SC: AuthenticationError
        SC-->>Student: 401 Unauthorized
    else account found
        Auth->>Auth: verifyPassword(), issue session scoped to this student only
        Auth-->>SC: SessionDTO
        SC-->>Student: 200 OK + session token
    end
```

**Note:** The issued session is scoped to a single `studentId`; every later query (e.g. `GET /api/credentials`) is implicitly filtered to that student, enforcing FR-STU-04.

---

## 3. Import Academic Record → Wallet Provisioning → Eligibility Evaluation

**Traces to:** UC-03, UC-05, UC-21 · FR-STU-01–03, FR-ELIG-01–08, FR-WAL-01, AS-01

```mermaid
sequenceDiagram
    actor Source as Academic Record Source
    participant AC as AcademicRecordController
    participant ARS as AcademicRecordService
    participant SRepo as IStudentRepository / IAcademicRecordRepository
    participant WS as StudentWalletService
    participant WA as WaltIdWalletAdapter
    participant Walt as walt.id Wallet API
    participant ES as EligibilityService
    participant ERepo as IEligibilityRepository

    Source->>AC: POST /api/academic-records/import {payload}
    AC->>ARS: importRecord(payload)
    ARS->>SRepo: findProgram(programId)

    alt program unknown
        SRepo-->>ARS: not found
        ARS-->>AC: ImportRejected(unknown program)
        AC-->>Source: 422 Unprocessable Entity
    else program known
        ARS->>SRepo: create/update STUDENT & ACADEMIC_RECORD
        SRepo-->>ARS: ok
        ARS->>ARS: log import event (FR-AUD-07)

        opt student has no active wallet
            ARS->>WS: provisionWallet(studentId)
            WS->>WA: provisionCustodialWallet(studentIdentifier)
            WA->>Walt: create server-managed wallet
            alt walt.id succeeds
                Walt-->>WA: wallet_id, DID
                WA-->>WS: WalletProvisionResult(ACTIVE)
                WS->>SRepo: save wallet_id, wallet_status = ACTIVE
            else walt.id fails or times out
                Walt-->>WA: error / timeout
                WA-->>WS: failure
                WS->>SRepo: wallet_status = FAILED
            end
            WS->>WS: log wallet provisioning audit event (FR-AUD-10)
            WS-->>ARS: WalletStatusDTO
        end

        ARS->>ES: evaluate(studentId, programId)
        ES->>ERepo: load academic record + active rule set
        ERepo-->>ES: AcademicRecord, EligibilityRuleSet
        ES->>ES: check each mandatory rule

        alt all mandatory rules pass
            ES->>ERepo: saveEvaluation(ELIGIBLE)
        else one or more rules fail
            ES->>ERepo: saveEvaluation(NOT_ELIGIBLE, failedRequirements)
        end
        ES->>ES: log evaluation event (FR-AUD-08)
        ES-->>ARS: EvaluationResultDTO
        ARS-->>AC: ImportResultDTO
        AC-->>Source: 201 Created
    end
```

**Note:** This same sequence, entered directly at `ARS->>ES: evaluate(...)`, also covers a Registrar's manual "re-evaluate" action (UC-05's alternate trigger).

---

## 4. Manual Wallet Provisioning / Retry

**Traces to:** UC-21, UC-22 · FR-WAL-01, FR-WAL-02, FR-WAL-03, FR-AUD-10

```mermaid
sequenceDiagram
    actor Staff as Registrar / Platform Administrator
    participant STC as StudentController
    participant WS as StudentWalletService
    participant SRepo as IStudentRepository
    participant WA as WaltIdWalletAdapter
    participant Walt as walt.id Wallet API

    Staff->>STC: POST /api/students/{id}/wallet/provision
    STC->>WS: provisionWallet(studentId)
    WS->>SRepo: findById(studentId)
    SRepo-->>WS: Student

    alt wallet_status already ACTIVE
        WS-->>STC: WalletStatusDTO(ACTIVE) — no-op
        STC-->>Staff: 200 OK (already active)
    else PENDING or FAILED
        WS->>SRepo: set wallet_status = PENDING
        WS->>WA: provisionCustodialWallet(studentIdentifier)
        WA->>Walt: create server-managed wallet

        alt success
            Walt-->>WA: wallet_id, DID
            WA-->>WS: success
            WS->>SRepo: save wallet_id, wallet_status = ACTIVE
        else failure
            Walt-->>WA: error / timeout
            WA-->>WS: failure detail
            WS->>SRepo: wallet_status = FAILED
        end

        WS->>WS: log wallet provisioning audit event (FR-AUD-10)
        WS-->>STC: WalletStatusDTO
        STC-->>Staff: 200 OK
    end
```

---

## 5. Create Issuance Request → Approve → Issue

**Traces to:** UC-07, UC-08, UC-10, UC-21 · FR-APPR-01–10, FR-CRED-01–06, FR-WAL-04

```mermaid
sequenceDiagram
    actor Reg as Registrar
    participant CRC as CredentialRequestController
    participant IRS as IssuanceRequestService
    participant ERepo as IEligibilityRepository
    participant SRepo as IStudentRepository
    participant RRepo as ICredentialRequestRepository
    actor App as Approver
    participant PRepo as IApprovalPolicyRepository
    participant CS as CredentialService
    participant VC as WaltIdVCAdapter
    participant Walt as walt.id Issuer
    participant CRepo as ICredentialRepository

    Reg->>CRC: POST /api/credential-requests {studentId, programId, credentialType}
    CRC->>IRS: createRequest(studentId, programId, credentialType, staffId)
    IRS->>ERepo: findLatestByStudent(studentId, programId)
    ERepo-->>IRS: EligibilityEvaluation

    alt latest evaluation is NOT_ELIGIBLE
        IRS-->>CRC: Refused(failedRequirements)
        CRC-->>Reg: 422 Unprocessable Entity + failed requirements
    else ELIGIBLE
        IRS->>SRepo: findById(studentId)
        SRepo-->>IRS: Student(wallet_status)

        alt wallet_status != ACTIVE
            IRS-->>CRC: Refused(wallet not ready)
            CRC-->>Reg: 409 Conflict — provision/retry wallet first
        else wallet ACTIVE
            IRS->>RRepo: findActiveByStudentAndType(studentId, credentialType)
            alt an active or already-issued request exists
                RRepo-->>IRS: existing request
                IRS-->>CRC: Refused(duplicate)
                CRC-->>Reg: 409 Conflict — duplicate request
            else none found
                RRepo-->>IRS: null
                IRS->>RRepo: saveRequest(PENDING_APPROVAL, linked to evaluation)
                RRepo-->>IRS: RequestDTO
                IRS-->>CRC: RequestDTO
                CRC-->>Reg: 201 Created (PENDING_APPROVAL)
            end
        end
    end

    Note over App,CRC: Later — Approver reviews the pending queue
    App->>CRC: GET /api/credential-requests/pending
    CRC->>IRS: listPending()
    IRS->>RRepo: listPending()
    RRepo-->>IRS: List<RequestDTO>
    IRS-->>CRC: List<RequestDTO>
    CRC-->>App: 200 OK

    App->>CRC: POST /api/credential-requests/{id}/approve {comment}
    CRC->>IRS: approve(requestId, approverId, comment)
    IRS->>RRepo: hasApproverVoted(requestId, approverId)

    alt approver already voted on this request
        RRepo-->>IRS: true
        IRS-->>CRC: Ignored — does not count twice
        CRC-->>App: 200 OK (no-op)
    else first vote from this approver
        RRepo-->>IRS: false
        IRS->>RRepo: saveApproval(APPROVE, approverId, comment)
        IRS->>RRepo: countApprovals(requestId)
        RRepo-->>IRS: currentApprovalCount
        IRS->>PRepo: getPolicy()
        PRepo-->>IRS: requiredApprovals

        alt currentApprovalCount < requiredApprovals
            IRS-->>CRC: RequestDTO(still PENDING_APPROVAL)
            CRC-->>App: 200 OK — awaiting more approvals
        else threshold met
            IRS->>CS: issue(requestId)
            CS->>RRepo: findById(requestId)
            RRepo-->>CS: CredentialIssuanceRequest
            CS->>SRepo: findById(studentId)
            SRepo-->>CS: Student(wallet_id)
            CS->>CS: build CredentialSubject from schema + request data
            CS->>VC: issueDiplomaVC(wallet_id, subject)
            VC->>Walt: OID4VCI issuance exchange

            alt walt.id issuance fails
                Walt-->>VC: error
                VC-->>CS: failure
                CS->>CS: log failure, leave request in last-approved state (retryable)
                CS-->>IRS: IssuanceFailed
                IRS-->>CRC: RequestDTO(approved, not yet issued)
                CRC-->>App: 200 OK — issuance pending retry
            else success
                Walt-->>VC: vc_reference
                VC-->>CS: VCReferenceResult
                CS->>CRepo: save CREDENTIAL(status = VALID, vc_reference)
                CS->>RRepo: markIssued(requestId)
                CS->>CS: log issuance audit event (FR-AUD-01)
                CS-->>IRS: CredentialDTO
                IRS-->>CRC: RequestDTO(ISSUED)
                CRC-->>App: 200 OK — issued
            end
        end
    end
```

---

## 6. Reject Issuance Request

**Traces to:** UC-09 · FR-APPR-07, FR-APPR-08

```mermaid
sequenceDiagram
    actor App as Approver
    participant CRC as CredentialRequestController
    participant IRS as IssuanceRequestService
    participant RRepo as ICredentialRequestRepository

    App->>CRC: POST /api/credential-requests/{id}/reject {reason}
    CRC->>IRS: reject(requestId, approverId, reason)
    IRS->>RRepo: findById(requestId)
    RRepo-->>IRS: CredentialIssuanceRequest(PENDING_APPROVAL)
    IRS->>RRepo: saveApproval(REJECT, approverId, reason)
    IRS->>RRepo: set status = REJECTED
    IRS->>IRS: log rejection audit event (FR-AUD-02)
    IRS-->>CRC: RequestDTO(REJECTED)
    CRC-->>App: 200 OK
```

---

## 7. View Credential

**Traces to:** UC-11 · FR-CRED-07, FR-CRED-08, FR-STU-04

```mermaid
sequenceDiagram
    actor Student
    participant CC as CredentialController
    participant CS as CredentialService
    participant CRepo as ICredentialRepository

    Student->>CC: GET /api/credentials
    CC->>CS: listCredentials(studentId from session)
    CS->>CRepo: findByStudentId(studentId)
    CRepo-->>CS: List<Credential>
    CS-->>CC: List<CredentialDTO>
    CC-->>Student: 200 OK — name, degree, program, field, university, awardDate, status
```

---

## 8. Create Verification Share

**Traces to:** UC-12 · FR-SHARE-01–04

```mermaid
sequenceDiagram
    actor Student
    participant SHC as ShareController
    participant SS as ShareService
    participant CRepo as ICredentialRepository
    participant SHRepo as IShareRepository
    participant TG as CryptoTokenGenerator

    Student->>SHC: POST /api/credentials/{id}/shares {expiresAt, purpose}
    SHC->>SS: createShare(credentialId, studentId, expiresAt, purpose)
    SS->>CRepo: findById(credentialId)
    CRepo-->>SS: Credential

    alt credential.status != VALID
        SS-->>SHC: Refused(credential not shareable)
        SHC-->>Student: 409 Conflict
    else VALID
        SS->>TG: generateOpaqueToken()
        TG-->>SS: token
        SS->>TG: hashToken(token)
        TG-->>SS: token_hash
        SS->>SHRepo: save SHARE {token_hash, expires_at, purpose}
        SHRepo-->>SS: ShareDTO
        SS->>SS: log share-created audit event (FR-AUD-04)
        SS-->>SHC: ShareResultDTO(public URL containing raw token)
        SHC-->>Student: 201 Created {url}
    end
```

**Note:** Only `token_hash` is persisted; the raw token is returned once, in the URL, and never stored server-side — enforcing NFR-01's "opaque, unguessable share tokens."

---

## 9. Revoke Verification Share

**Traces to:** UC-13 · FR-SHARE-06, FR-SHARE-07

```mermaid
sequenceDiagram
    actor Student
    participant SHC as ShareController
    participant SS as ShareService
    participant SHRepo as IShareRepository

    Student->>SHC: POST /api/shares/{id}/revoke
    SHC->>SS: revokeShare(shareId, studentId)
    SS->>SHRepo: findById(shareId)
    SHRepo-->>SS: Share

    alt share does not belong to this student
        SS-->>SHC: Forbidden
        SHC-->>Student: 403 Forbidden
    else owned by this student
        SS->>SHRepo: set revoked_at = now()
        SS->>SS: log share-revoked audit event (FR-AUD-04)
        SS-->>SHC: ShareResultDTO(revoked)
        SHC-->>Student: 200 OK
    end
```

---

## 10. Public Verification

**Traces to:** UC-14 · FR-VER-01–08, FR-AUD-05, NFR-02, NFR-07

```mermaid
sequenceDiagram
    actor Verifier
    participant PVC as PublicVerificationController
    participant SS as ShareService
    participant VS as VerificationService
    participant SHRepo as IShareRepository
    participant CRepo as ICredentialRepository
    participant VC as WaltIdVCAdapter
    participant Walt as walt.id Verifier
    participant ERepo as IVerificationEventRepository

    Verifier->>PVC: GET /api/public/shares/{token}
    PVC->>SS: resolveShare(token)
    SS->>SHRepo: findByTokenHash(hash(token))
    SHRepo-->>SS: Share | null
    SS-->>PVC: ShareStatusDTO
    PVC-->>Verifier: 200 OK — active / expired / revoked

    Verifier->>PVC: POST /api/public/shares/{token}/verify
    PVC->>VS: verify(token, ipAddress, userAgent)
    VS->>SHRepo: findByTokenHash(hash(token))
    SHRepo-->>VS: Share | null

    alt share missing, expired, or revoked
        VS->>ERepo: save VerificationEvent(EXPIRED_SHARE)
        VS-->>PVC: EXPIRED_SHARE
        PVC-->>Verifier: 200 OK {result: EXPIRED_SHARE}
    else share active and unexpired
        VS->>CRepo: findById(share.credentialId)
        CRepo-->>VS: Credential

        alt credential.status == REVOKED
            VS->>ERepo: save VerificationEvent(REVOKED)
            VS-->>PVC: REVOKED
            PVC-->>Verifier: 200 OK {result: REVOKED}
        else credential VALID
            VS->>VC: verifyDiplomaVC(vc_reference)
            VC->>Walt: OID4VP exchange — issuer + integrity + status

            alt walt.id call fails or times out
                Walt-->>VC: error
                VC-->>VS: failure
                VS->>ERepo: save VerificationEvent(VERIFICATION_ERROR)
                VS-->>PVC: VERIFICATION_ERROR
                PVC-->>Verifier: 200 OK {result: VERIFICATION_ERROR}
            else walt.id responds
                Walt-->>VC: issuer / integrity / status outcome
                VC-->>VS: VerificationOutcome

                alt issuer or integrity not confirmed
                    VS->>ERepo: save VerificationEvent(UNKNOWN_ISSUER | INVALID_CREDENTIAL)
                    VS-->>PVC: UNKNOWN_ISSUER | INVALID_CREDENTIAL
                    PVC-->>Verifier: 200 OK {result}
                else confirmed
                    VS->>ERepo: save VerificationEvent(VERIFIED)
                    VS-->>PVC: VERIFIED + plain-language summary
                    PVC-->>Verifier: 200 OK {result: VERIFIED, name, degree, program, institution, awardDate}
                end
            end
        end
    end
```

**Note (NFR-07 / trust boundary):** Nothing in this sequence re-checks grades, courses, or the eligibility decision — `VerificationService` only ever queries `Credential` and calls `IVCAdapter`, never `IEligibilityRepository` or `IAcademicRecordRepository`.

---

## 11. Revoke Credential

**Traces to:** UC-15 · FR-CRED-09–11

```mermaid
sequenceDiagram
    actor Reg as Registrar
    participant CC as CredentialController
    participant CS as CredentialService
    participant CRepo as ICredentialRepository
    participant VC as WaltIdVCAdapter
    participant DB as Postgres (Status List Store)

    Reg->>CC: POST /api/credentials/{id}/revoke {reason}
    CC->>CS: revoke(credentialId, reason, staffId)
    CS->>CRepo: findById(credentialId)
    CRepo-->>CS: Credential(VALID)
    CS->>VC: revokeDiplomaVC(vc_reference, reason)
    VC->>DB: toggle bit in W3C Bitstring Status List (self-hosted)
    DB-->>VC: acknowledged
    VC-->>CS: success
    CS->>CRepo: update status = REVOKED, revoked_at, revocation_reason, actor
    CS->>CS: log revocation audit event (FR-AUD-03)
    CS-->>CC: CredentialDTO(REVOKED)
    CC-->>Reg: 200 OK
```

---

## 12. Reissue Credential

**Traces to:** UC-16 · FR-CRED-12–13, FR-ELIG-10

```mermaid
sequenceDiagram
    actor Reg as Registrar
    participant CC as CredentialController
    participant CS as CredentialService
    participant CRepo as ICredentialRepository
    participant ES as EligibilityService
    participant IRS as IssuanceRequestService

    Reg->>CC: POST /api/credentials/{id}/reissue
    CC->>CS: reissue(credentialId, staffId)
    CS->>CRepo: findById(credentialId)
    CRepo-->>CS: Credential(REVOKED)
    CS->>ES: evaluate(studentId, programId)
    ES-->>CS: EvaluationResultDTO

    alt student NOT_ELIGIBLE under current rules
        CS-->>CC: Refused(cannot reissue — not eligible)
        CC-->>Reg: 422 Unprocessable Entity
    else ELIGIBLE
        CS->>IRS: createRequest(studentId, programId, credentialType, staffId, supersedesCredentialId = credentialId)
        Note over IRS: Re-enters the full approval workflow — see Diagram 5
        IRS-->>CS: RequestDTO(PENDING_APPROVAL)
        CS-->>CC: RequestDTO
        CC-->>Reg: 201 Created — pending approval
    end
```

---

## 13. View Audit History

**Traces to:** UC-17 · FR-AUD-01–10, NFR-06

```mermaid
sequenceDiagram
    actor A as Registrar / Student
    participant AC as AuditController
    participant AS as AuditService
    participant ERepo as IVerificationEventRepository

    A->>AC: GET /api/audit?scope=...
    AC->>AS: getAuditHistory(scope)
    AS->>AS: authorize scope — system-wide for Registrar, own-records-only for Student
    AS->>ERepo: fetch chronological events for scope
    ERepo-->>AS: import, wallet, evaluation, approval/rejection, issuance, revocation, share, and verification events
    AS-->>AC: List<AuditEventDTO>
    AC-->>A: 200 OK — scoped, chronological
```

---

## 14. Staff User Management (Create / Update / Deactivate)

**Traces to:** UC-20 · FR-USER-01–03, FR-USER-05, FR-AUD-09

```mermaid
sequenceDiagram
    actor Admin as Platform Administrator
    participant SC as StaffController
    participant SS as StaffService
    participant Repo as IStaffRepository
    participant PH as BcryptPasswordHasher

    Admin->>SC: POST /api/staff {name, email, password, role}
    SC->>SS: createStaff(name, email, password, role)
    SS->>Repo: findByEmail(email)

    alt email already registered
        Repo-->>SS: existing staff
        SS-->>SC: ConflictError(duplicate email)
        SC-->>Admin: 409 Conflict
    else email is free
        Repo-->>SS: null
        SS->>PH: hash(password)
        PH-->>SS: passwordHash
        SS->>Repo: save UNIVERSITY_STAFF(status = ACTIVE)
        Repo-->>SS: StaffDTO
        SS->>SS: log user-management audit event (FR-AUD-09)
        SS-->>SC: StaffDTO
        SC-->>Admin: 201 Created
    end

    Admin->>SC: PATCH /api/staff/{id} {roles, profile}
    SC->>SS: updateStaff(staffId, profile, roles)
    SS->>Repo: findById(staffId)
    Repo-->>SS: UniversityStaff
    SS->>Repo: update roles / profile
    SS->>SS: log user-management audit event
    SS-->>SC: StaffDTO
    SC-->>Admin: 200 OK

    Admin->>SC: DELETE /api/staff/{id} (deactivate)
    SC->>SS: deactivateStaff(staffId)
    SS->>Repo: countActiveAdmins()
    Repo-->>SS: count

    alt target is the last active Admin
        SS-->>SC: Refused(cannot deactivate last Admin)
        SC-->>Admin: 409 Conflict
    else safe to deactivate
        SS->>Repo: set status = INACTIVE, invalidate active sessions
        SS->>SS: log user-management audit event (FR-AUD-09)
        SS-->>SC: StaffDTO(INACTIVE)
        SC-->>Admin: 200 OK
    end
```

---

## 15. View & Manage Student Accounts

**Traces to:** UC-22 · FR-USER-04, FR-STU-02, FR-STU-03, FR-WAL-03

```mermaid
sequenceDiagram
    actor Staff as Registrar / Platform Administrator
    participant STC as StudentController
    participant WS as StudentWalletService
    participant Repo as IStudentRepository

    Staff->>STC: GET /api/students?filter=...
    STC->>WS: listStudents(filter)
    WS->>Repo: listPaged(filter)
    Repo-->>WS: PagedList<Student>
    WS-->>STC: PagedResult<StudentDTO>
    STC-->>Staff: 200 OK — student number, name, program, enrollment status, wallet status

    Staff->>STC: GET /api/students/{id}
    STC->>WS: getStudent(studentId)
    WS->>Repo: findById(studentId)
    Repo-->>WS: Student
    WS-->>STC: StudentDTO — profile, linked academic record, eligibility evaluations, credentials
    STC-->>Staff: 200 OK
```

---

## 16. Diagram Cross-Reference

| Diagram                               | Use Cases                  | Key Requirements                              | Application Services Involved                                   |
| ------------------------------------- | -------------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| 1. Staff Login                        | UC-01                      | FR-AUTH-01, FR-AUTH-02, FR-AUTH-04            | AuthService                                                     |
| 2. Student Login                      | UC-02                      | FR-AUTH-03, FR-STU-04                         | AuthService                                                     |
| 3. Import → Wallet → Eligibility      | UC-03, UC-05, UC-21        | FR-STU-01–03, FR-ELIG-01–08, FR-WAL-01, AS-01 | AcademicRecordService, StudentWalletService, EligibilityService |
| 4. Manual Wallet Provisioning / Retry | UC-21, UC-22               | FR-WAL-01–03, FR-AUD-10                       | StudentWalletService                                            |
| 5. Create Request → Approve → Issue   | UC-07, UC-08, UC-10, UC-21 | FR-APPR-01–10, FR-CRED-01–06, FR-WAL-04       | IssuanceRequestService, CredentialService                       |
| 6. Reject Issuance Request            | UC-09                      | FR-APPR-07, FR-APPR-08                        | IssuanceRequestService                                          |
| 7. View Credential                    | UC-11                      | FR-CRED-07, FR-CRED-08, FR-STU-04             | CredentialService                                               |
| 8. Create Verification Share          | UC-12                      | FR-SHARE-01–04                                | ShareService                                                    |
| 9. Revoke Verification Share          | UC-13                      | FR-SHARE-06, FR-SHARE-07                      | ShareService                                                    |
| 10. Public Verification               | UC-14                      | FR-VER-01–08, FR-AUD-05, NFR-02, NFR-07       | ShareService, VerificationService                               |
| 11. Revoke Credential                 | UC-15                      | FR-CRED-09–11                                 | CredentialService                                               |
| 12. Reissue Credential                | UC-16                      | FR-CRED-12–13, FR-ELIG-10                     | CredentialService, EligibilityService, IssuanceRequestService   |
| 13. View Audit History                | UC-17                      | FR-AUD-01–10, NFR-06                          | AuditService                                                    |
| 14. Staff User Management             | UC-20                      | FR-USER-01–03, FR-USER-05, FR-AUD-09          | StaffService                                                    |
| 15. View & Manage Student Accounts    | UC-22                      | FR-USER-04, FR-STU-02, FR-STU-03, FR-WAL-03   | StudentWalletService                                            |

Together, Diagrams 1–15 cover every use case in `Use_Cases.md` and every Application Service defined in `Class_Diagram.md` §4, showing the same workflows as `Activity_Diagrams.md` at the object-interaction level rather than the control-flow level.
