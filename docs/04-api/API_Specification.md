# API Specification

**Version:** 0.1.0

Implements the HTTP interface required by `docs/01-requirements/SRS.md` Section 5, mapped to the **Clean Architecture** defined in `docs/03-design/Architecture_Design.md` and `docs/03-design/Class_Diagram.md`. Single tenant: there is no `{universityId}` path segment anywhere.

---

## 1. Architecture & Service Mapping Summary

All endpoints are implemented as thin HTTP controllers delegating directly to domain-aligned **Application Services** via dependency injection:

| HTTP Method & Path                             | Application Service      | Method            | Side Effects / Persisted State                                                 |
| :--------------------------------------------- | :----------------------- | :---------------- | :----------------------------------------------------------------------------- |
| `POST /api/auth/login`                         | `AuthService`            | `login`           | Generates JWT session token                                                    |
| `POST /api/staff`                              | `StaffService`           | `createStaff`     | Persists `UNIVERSITY_STAFF`                                                    |
| `PATCH /api/staff/{id}`                        | `StaffService`           | `updateStaff`     | Updates `UNIVERSITY_STAFF`                                                     |
| `POST /api/staff/{id}/deactivate`              | `StaffService`           | `deactivateStaff` | Sets `UNIVERSITY_STAFF.status = INACTIVE`                                      |
| `GET /api/staff`                               | `StaffService`           | `listStaff`       | None (Read-only)                                                               |
| `GET /api/students`                            | `StudentWalletService`   | `listStudents`    | None (Read-only)                                                               |
| `GET /api/students/{id}`                       | `StudentWalletService`   | `getStudent`      | None (Read-only)                                                               |
| `POST /api/students/{id}/wallet/provision`     | `StudentWalletService`   | `provisionWallet` | Calls `IWalletAdapter`, updates `STUDENT.wallet_id`                            |
| `POST /api/academic-records/import`            | `AcademicRecordService`  | `importRecord`    | Persists `STUDENT` & `ACADEMIC_RECORD`, triggers wallet & eligibility          |
| `GET /api/students/{id}/academic-record`       | `AcademicRecordService`  | `getRecord`       | None (Read-only)                                                               |
| `POST /api/students/{id}/eligibility/evaluate` | `EligibilityService`     | `evaluate`        | Persists `ELIGIBILITY_EVALUATION`                                              |
| `GET /api/students/{id}/eligibility`           | `EligibilityService`     | `getLatestResult` | None (Read-only)                                                               |
| `POST /api/credential-requests`                | `IssuanceRequestService` | `createRequest`   | Persists `CREDENTIAL_ISSUANCE_REQUEST`                                         |
| `GET /api/credential-requests`                 | `IssuanceRequestService` | `listPending`     | None (Read-only)                                                               |
| `POST /api/credential-requests/{id}/approve`   | `IssuanceRequestService` | `approve`         | Persists `CREDENTIAL_APPROVAL`, calls `CredentialService.issue()` on threshold |
| `POST /api/credential-requests/{id}/reject`    | `IssuanceRequestService` | `reject`          | Updates `CREDENTIAL_ISSUANCE_REQUEST.status = REJECTED`                        |
| `GET /api/credentials`                         | `CredentialService`      | `listCredentials` | None (Read-only)                                                               |
| `GET /api/credentials/{id}`                    | `CredentialService`      | `getDetails`      | None (Read-only)                                                               |
| `POST /api/credentials/{id}/revoke`            | `CredentialService`      | `revoke`          | Updates status list & sets `CREDENTIAL.status = REVOKED`                       |
| `POST /api/credentials/{id}/reissue`           | `CredentialService`      | `reissue`         | Creates superseding `CREDENTIAL_ISSUANCE_REQUEST`                              |
| `GET /api/status/{listId}`                     | `CredentialService`      | `getStatusList`   | None (Serves public W3C Bitstring Status List)                                 |
| `POST /api/credentials/{id}/shares`            | `ShareService`           | `createShare`     | Persists `SHARE` with hashed opaque token                                      |
| `GET /api/credentials/{id}/shares`             | `ShareService`           | `listShares`      | None (Read-only)                                                               |
| `POST /api/shares/{id}/revoke`                 | `ShareService`           | `revokeShare`     | Sets `SHARE.revoked_at`                                                        |
| `GET /api/public/shares/{token}`               | `ShareService`           | `resolveShare`    | None (Read-only pre-check)                                                     |
| `POST /api/public/shares/{token}/verify`       | `VerificationService`    | `verify`          | Calls `IVCAdapter`, persists `VERIFICATION_EVENT`                              |
| `GET /api/audit/...`                           | `AuditService`           | `getAuditHistory` | None (Read-only)                                                               |

---

## 2. Authentication

```
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
```

---

## 3. University Configuration

```
GET    /api/university
PATCH  /api/university
```

---

## 4. Staff User Management (Admin Only)

```
GET    /api/staff
POST   /api/staff
GET    /api/staff/{staffId}
PATCH  /api/staff/{staffId}
POST   /api/staff/{staffId}/deactivate
```

**Create staff user (`StaffService.createStaff`):**

```json
POST /api/staff
{
  "name": "Nguyen Anh Minh",
  "email": "minh.nguyen@miu.example",
  "password": "SecurePassword123!",
  "role": "REGISTRAR"
}
```

Response:

```json
{
    "staffId": "staff-uuid-1",
    "name": "Nguyen Anh Minh",
    "email": "minh.nguyen@miu.example",
    "role": "REGISTRAR",
    "status": "ACTIVE",
    "createdAt": "2026-08-27T10:00:00Z"
}
```

**Update staff user / role (`StaffService.updateStaff`):**

```json
PATCH /api/staff/{staffId}
{
  "role": "APPROVER",
  "name": "Nguyen Anh Minh"
}
```

**Deactivate staff user (`StaffService.deactivateStaff`):**

```json
POST /api/staff/{staffId}/deactivate
```

Response:

```json
{
    "staffId": "staff-uuid-1",
    "status": "INACTIVE",
    "updatedAt": "2026-08-27T10:30:00Z"
}
```

---

## 5. Student Management & Wallet Provisioning

```
GET    /api/students
GET    /api/students/{studentId}
POST   /api/students/{studentId}/wallet/provision
GET    /api/students/{studentId}/wallet
```

**List students (`StudentWalletService.listStudents`):**

```json
GET /api/students?programId=program-uuid&page=1&limit=20
```

Response:

```json
{
    "students": [
        {
            "studentId": "student-uuid-1",
            "studentNumber": "MIU2026-001",
            "name": "Nguyen Minh Anh",
            "email": "anh.nguyen@miu.example",
            "programId": "program-uuid",
            "programName": "Computer Science",
            "status": "ACTIVE",
            "walletStatus": "ACTIVE",
            "importedAt": "2026-08-20T08:30:00Z"
        }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
}
```

**Provision / Retry student wallet (`StudentWalletService.provisionWallet`):**

```json
POST /api/students/{studentId}/wallet/provision
```

Response:

```json
{
    "studentId": "student-uuid-1",
    "walletId": "walt-wallet-uuid-456",
    "walletStatus": "ACTIVE",
    "provisionedAt": "2026-08-27T11:00:00Z"
}
```

---

## 6. Programs & Eligibility Rules

```
GET    /api/programs
POST   /api/programs
GET    /api/programs/{programId}
PATCH  /api/programs/{programId}

GET    /api/programs/{programId}/eligibility-rules
PUT    /api/programs/{programId}/eligibility-rules
```

**Set eligibility rules (`EligibilityService.saveRuleSet`):**

```json
PUT /api/programs/{programId}/eligibility-rules
{
  "rules": [
    { "type": "MIN_CREDITS", "value": 120 },
    { "type": "MIN_GPA", "value": 2.0 },
    { "type": "REQUIRED_COURSE", "value": "CS499 Capstone" }
  ]
}
```

Each write creates a new rule-set version; existing `ELIGIBILITY_EVALUATION` records keep referencing the version they were run against (FR-ELIG-10, see `Data_Model.md`).

---

## 7. Academic Records (Inbound Ingestion)

```
POST   /api/academic-records/import
GET    /api/students/{studentId}/academic-record
```

**Import (`AcademicRecordService.importRecord`):**

```json
POST /api/academic-records/import
{
  "studentNumber": "MIU2026-001",
  "name": "Nguyen Minh Anh",
  "email": "anh.nguyen@miu.example",
  "programId": "program-uuid",
  "credits": 128,
  "gpa": 3.6,
  "completedCourses": ["CS101", "CS499", "..."]
}
```

This creates or updates the `STUDENT` record, provisions a server-managed custodial wallet in walt.id (via `IWalletAdapter`) if not already present, stores the associated `ACADEMIC_RECORD`, and automatically triggers eligibility evaluation (Architecture_Design.md Section 2). This is the **only** path by which student/academic data enters the system.

---

## 8. Eligibility Evaluation

```
POST   /api/students/{studentId}/eligibility/evaluate
GET    /api/students/{studentId}/eligibility
```

**Evaluate (`EligibilityService.evaluate`):**

```json
POST /api/students/{studentId}/eligibility/evaluate
{
  "programId": "program-uuid"
}
```

Response:

```json
{
    "evaluationId": "eval-uuid",
    "result": "NOT_ELIGIBLE",
    "evaluatedAt": "2026-08-20T09:00:00Z",
    "ruleSetVersion": 3,
    "failedRequirements": [
        { "type": "MIN_CREDITS", "required": 120, "actual": 114 }
    ]
}
```

`GET /api/students/{studentId}/eligibility` (`EligibilityService.getLatestResult`) returns the latest evaluation for Registrar review (FR-ELIG-09).

---

## 9. Credential Issuance Requests & Approval

```
POST   /api/credential-requests
GET    /api/credential-requests
GET    /api/credential-requests/{requestId}
POST   /api/credential-requests/{requestId}/approve
POST   /api/credential-requests/{requestId}/reject
```

**Create a request (`IssuanceRequestService.createRequest`):**

```json
POST /api/credential-requests
{
  "studentId": "student-uuid",
  "programId": "program-uuid",
  "credentialType": "AcademicDiploma"
}
```

The backend checks the student's latest eligibility evaluation and wallet status. If not `ELIGIBLE` or if wallet is not `ACTIVE`, the request is rejected at creation time:

```json
{
    "error": "NOT_ELIGIBLE",
    "message": "Student does not satisfy mandatory graduation requirements.",
    "failedRequirements": [
        { "type": "MIN_CREDITS", "required": 120, "actual": 114 }
    ]
}
```

Otherwise the request is created in `PENDING_APPROVAL`:

```json
{
    "requestId": "req-uuid",
    "status": "PENDING_APPROVAL",
    "eligibilityEvaluationId": "eval-uuid",
    "requiredApprovals": 1,
    "approvalsReceived": 0
}
```

**Approve (`IssuanceRequestService.approve`):**

```json
POST /api/credential-requests/{requestId}/approve
{
  "comment": "Confirmed graduation record"
}
```

When `approvalsReceived` reaches `requiredApprovals` (1 in the MVP), the service automatically calls `CredentialService.issue()`, invoking `IVCAdapter.issueDiplomaVC()` with status list metadata into the student's server-managed wallet (Section 10), and the request's terminal state becomes `ISSUED`.

**Reject (`IssuanceRequestService.reject`):**

```json
POST /api/credential-requests/{requestId}/reject
{
  "reason": "Program record mismatch"
}
```

---

## 10. Credentials

Issuance is internal, triggered automatically when a request satisfies the approval policy:

```
1. Request fully approved (implies passing eligibility evaluation and active wallet)
2. Load preconfigured schema configuration & status list index
3. Build credential subject
4. Call walt.id Issuer (via IVCAdapter) targeting student's wallet_id with credentialStatus runtime override
5. Store credential metadata and vc_reference in PostgreSQL
6. Mark request ISSUED, credential status VALID
```

```
GET    /api/credentials
GET    /api/credentials/{credentialId}
POST   /api/credentials/{credentialId}/revoke
POST   /api/credentials/{credentialId}/reissue
```

**Revoke (`CredentialService.revoke`):**

```json
POST /api/credentials/{credentialId}/revoke
{
  "reason": "Incorrect graduate information"
}
```

This updates `CREDENTIAL.status = REVOKED` and `revocation_reason` in PostgreSQL and marks the credential's entry in the self-hosted W3C Bitstring Status List as revoked.

**Reissue (`CredentialService.reissue`):** creates a new `CredentialIssuanceRequest` linked via `supersedesCredentialId`. It is re-evaluated for eligibility and re-enters the full approval workflow:

```
POST /api/credentials/{credentialId}/reissue
```

---

## 11. Student Portal

```
GET /api/me
GET /api/me/credentials
GET /api/me/shares
GET /api/me/verification-events
```

---

## 12. Student Shares

```
POST   /api/credentials/{credentialId}/shares
GET    /api/credentials/{credentialId}/shares
POST   /api/shares/{shareId}/revoke
```

**Create share (`ShareService.createShare`):**

```json
POST /api/credentials/{credentialId}/shares
{
  "purpose": "Employment verification",
  "expiresAt": "2026-09-24T23:59:59Z"
}
```

Response:

```json
{
    "shareId": "share-uuid",
    "url": "https://verify.miu.example/s/7Kx92A",
    "expiresAt": "2026-09-24T23:59:59Z"
}
```

---

## 13. Public Verification

No authentication required. Never returns internal identifiers, source academic-record data, or eligibility details — only the credential fields listed in SRS FR-CRED-08.

**Resolve share pre-check (`ShareService.resolveShare`):**

```
GET /api/public/shares/{token}
```

```json
{
    "shareStatus": "ACTIVE",
    "expiresAt": "2026-09-24T23:59:59Z"
}
```

**Verify (`VerificationService.verify`):**

```
POST /api/public/shares/{token}/verify
```

Backend flow:

```
Share token → valid? → credential exists? → credential active?
   → walt.id verifier (IVCAdapter) → issuer valid? → VC valid in wallet?
   → log VERIFICATION_EVENT to PostgreSQL → return result
```

Response:

```json
{
    "result": "VERIFIED",
    "credential": {
        "type": "AcademicDiploma",
        "holderName": "Nguyen Minh Anh",
        "degree": "Bachelor of Computer Science",
        "program": "Computer Science",
        "institution": "Mekong International University",
        "awardDate": "2026-06-15"
    },
    "issuer": {
        "name": "Mekong International University",
        "trusted": true
    },
    "status": "VALID"
}
```

`result` is one of: `VERIFIED`, `REVOKED`, `EXPIRED_SHARE`, `INVALID_CREDENTIAL`, `UNKNOWN_ISSUER`, `VERIFICATION_ERROR` (SRS FR-VER-07).

---

## 14. Public Credential Status List

Publicly accessible endpoint serving the W3C Bitstring Status List for cryptographic credential status checks (consumed by external verifiers and walt.id):

```
GET /api/status/{listId}
```

Response:

```json
{
    "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://w3id.org/vc/status-list/2021/v1"
    ],
    "id": "https://verify.miu.example/api/status/1",
    "type": ["VerifiableCredential", "StatusList2021Credential"],
    "issuer": "did:jwk:...",
    "issuanceDate": "2026-08-20T00:00:00Z",
    "credentialSubject": {
        "id": "https://verify.miu.example/api/status/1#list",
        "type": "StatusList2021",
        "statusPurpose": "revocation",
        "encodedList": "H4sIC..."
    }
}
```

---

## 15. Audit

Registrar/Approver/Admin (`AuditService.getAuditHistory`):

```
GET /api/audit
GET /api/audit/academic-records
GET /api/audit/eligibility-evaluations
GET /api/audit/wallets
GET /api/audit/users
GET /api/audit/credentials/{credentialId}
GET /api/audit/credential-requests/{requestId}
```
