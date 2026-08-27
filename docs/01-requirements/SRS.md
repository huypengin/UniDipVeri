# Software Requirements Specification — UniDipVeri

**Version:** 2.1

**Project type:** Undergraduate thesis prototype

**Institution:** Mekong International University (fictional)

**Primary domain:** Academic credential issuance and verification

**VC infrastructure:** walt.id Community Stack (see Architecture_Design.md)

**Deployment model:** Single university, single tenant

**Companion documents** (not part of this SRS):

- `docs/03-design/Architecture_Design.md` — system architecture, layering, VC adapter, system boundary
- `docs/03-design/Data_Model.md` — ERD and schema definitions
- `docs/05-api/API_Specification.md` — REST endpoint contracts

---

## 1. Introduction

### 1.1 Purpose

This document specifies the functional and non-functional requirements for UniDipVeri, a web-based platform that lets Mekong International University issue digitally verifiable academic diplomas, and lets graduates share those credentials with third parties through short-lived, self-service verification links.

### 1.2 Problem Statement

Traditional academic credential verification requires an employer to contact the university directly and wait for manual confirmation, which creates administrative workload, delay, and poor scalability. UniDipVeri replaces this with an issue-once, verify-anytime model based on Verifiable Credentials (VCs): the university issues a VC to the graduate, the graduate generates a temporary verification link, and any verifier can open that link and receive an automated, cryptographically-grounded result — with no account, and no phone call to the registrar.

### 1.3 Document Conventions

Requirements are labeled `FR-<AREA>-<NN>` (functional) and `NFR-<NN>` (non-functional) and are testable by construction. "Shall" denotes a mandatory requirement; "should" denotes a recommended but non-mandatory behavior.

### 1.4 Intended Audience

Thesis committee/reviewers, the system developer (author), and any future maintainer extending the prototype.

### 1.5 References

- walt.id Community Stack documentation
- `Architecture_Design.md`, `API_Specification.md`, `Data_Model.md` (this repository)

---

## 2. Overall Description

### 2.1 Product Perspective

UniDipVeri is a new, self-contained system. It integrates with walt.id for VC issuance and verification but owns its own domain model (users, students, programs, credentials, shares, audit log) independently of walt.id's internal representations. UniDipVeri receives academic records from an authoritative academic source system. Source academic records are assumed to be correct and authentic at the point of import. UniDipVeri does not independently authenticate individual grades or transcript entries. Instead, it evaluates imported academic data against configured graduation eligibility rules. Platform Administrators manage university staff accounts and roles. The system provisions server-managed wallets for students to hold credentials. Registrar users review and initiate credential issuance requests, while authorized Approvers authorize issuance before the credential is cryptographically issued.

### 2.2 Product Functions (Summary)

- Manage university users and roles (Platform Administrator, Registrar, Approver) and view student accounts.
- Provision and manage server-managed student wallets via the VC infrastructure (walt.id).
- Import or receive trusted academic records from the academic source system.
- Evaluate graduation eligibility using configurable academic rules.
- Issue academic diplomas as Verifiable Credentials, subject to an approval policy.
- Let students view their credentials and generate expiring, revocable public share links.
- Let anyone with a share link verify a credential without an account.
- Revoke and reissue credentials, with full lineage between superseded and superseding credentials.
- Maintain an audit trail of user management, wallet provisioning, issuance, approval, revocation, sharing, and verification events.

### 2.3 User Classes and Characteristics

| Role                   | Description                                                                                                                     | Technical proficiency assumed   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Academic Record Source | External system providing trusted academic records to UniDipVeri.                                                               | High                            |
| Platform Administrator | University IT/admin staff who manages staff user accounts and roles, schema, system settings, and approval policy               | Moderate                        |
| Registrar              | University staff who manages/reviews academic records, reviews eligibility results, and initiates credential issuance requests. | Low–moderate; uses a web portal |
| Approver               | University staff authorized to approve a pending credential issuance request before it is signed                                | Low; uses a web portal          |
| Student / Graduate     | Credential holder accessing credentials stored in their server-managed wallet                                                   | Low; general web user           |
| Verifier               | External employer or organization checking a credential                                                                         | None; anonymous, no account     |

A single staff account may hold multiple staff roles (e.g. Registrar and Approver) in the prototype, but the system shall treat them as distinct permissions so that a stricter policy (e.g., requiring a different person to approve) can be enabled without a redesign.

### 2.4 Operating Environment

Web application (server-rendered or SPA) served over HTTPS, backed by an application database and the walt.id Community Stack, deployable as a single-instance prototype (no high-availability requirement).

### 2.5 Assumptions and Dependencies

- **AS-01 — Source academic record trust:** Academic records received from the designated academic source system are assumed to be authentic and correct at the time of import. UniDipVeri does not independently verify the authenticity of individual grades, courses, or transcript entries. It verifies that a credential was issued by MIU and has not been revoked or altered, not that the underlying academic claim is true. Correctness of source data is the responsibility of the Registrar/University, not the system.
- **AS-02 — Single tenant:** The system is built and deployed for exactly one university (MIU). It is not designed to support multiple issuing institutions in the MVP (see 3.2).
- **AS-03** — walt.id's issuer, wallet, and verifier services are available and correctly configured with MIU's issuer identity/keys before any issuance, wallet provisioning, or verification can occur.
- **AS-04** — Users access the system over a modern browser with JavaScript enabled.
- **AS-05 — Eligibility rules:** Graduation eligibility rules configured for each academic program are assumed to accurately represent the university's graduation requirements.

### 2.6 Constraints

- The system shall not implement custom cryptography; all signing/verification is delegated to walt.id.
- The system shall not require students to install custom client wallet applications; credential holders view credentials through the UniDipVeri student portal backed by server-managed walt.id wallets.
- The domain/business layer shall not depend directly on walt.id-specific data structures (see Architecture_Design.md, NFR-05).

---

## 3. Scope

### 3.1 In Scope (MVP)

1. User management for university staff (create, read, update, deactivate staff accounts; assign roles: Registrar, Approver, Platform Administrator).
2. Student account and profile viewing for authorized staff.
3. Server-managed student wallet provisioning via walt.id Wallet API (automatic upon student import, with manual re-provisioning support).
4. Academic record import/ingestion from the designated academic source.
5. Graduation eligibility rule evaluation.
6. Eligibility result and failed-requirement reporting.
7. University staff authentication and role-based access.
8. Student authentication and credential access.
9. Academic program management.
10. Credential issuance requests with a configurable approval policy (MVP policy: 1 required approver).
11. VC generation via walt.id into the student's server-managed wallet upon approval.
12. Student credential viewing.
13. Creation of short-lived, revocable verification share links.
14. Public verification without verifier registration.
15. Cryptographic credential verification (issuer + integrity + status), delegated to walt.id.
16. Credential revocation.
17. Credential reissuance with lineage to the superseded credential.
18. Verification, issuance, approval, user management, wallet provisioning, and sharing event logging.
19. Basic audit history views for staff and students.

### 3.2 Out of Scope (MVP)

- Multi-tenant / multi-university support. The data model may use identifiers that happen to be unique per record, but no tenant-isolation, tenant-switching, or cross-university functionality shall be built, tested, or assumed to work.
- Verification of the _underlying academic record_ itself (grade authenticity, plagiarism, enrollment fraud, etc.) — see AS-01. The system verifies the credential, not the academic claim it encodes.
- Independent authentication or investigation of the underlying academic records, including verification of individual grades, course completion evidence, plagiarism, enrollment fraud, or other academic misconduct.
- Batch/bulk academic record import (multi-record upload, CSV/file-based ingestion). The MVP import path (FR-STU-01) handles one record per call; batching is an efficiency concern for large graduating cohorts, not a functional gap.
- Batch eligibility evaluation across a cohort in a single operation.
- Batch/bulk approval of multiple issuance requests in a single action.
- Blockchain of any kind.
- Custom cryptographic algorithms.
- Custom client-side wallet apps installed on student mobile devices.
- Arbitrary schema creation by non-administrator users.
- Decentralized trust governance across institutions.
- Mobile wallet application.
- Payment processing.
- Enterprise SSO / external IdP federation.
- Production-grade high availability.
- Full academic transcript management (course-level records).
- **Student-facing, holder-interactive OID4VP** (student's own wallet app, QR-scan/consent-tap flow) as the primary verification workflow — candidate future work. Note: walt.id's OID4VCI/OID4VP protocols are still used _internally_ by the system (see Architecture_Design.md §3a), driven entirely server-side against a server-managed wallet; what's out of scope here is exposing that protocol's interactive steps to the student or verifier.
- Approval policies more complex than "N of M approvers" (e.g., role-weighted or sequential approval chains) — the MVP implements only N=1.

---

## 4. Functional Requirements

### 4.1 Authentication

- **FR-AUTH-01** The system shall allow authorized Registrar, Approver, and Platform Administrator users to authenticate.
- **FR-AUTH-02** The system shall prevent unauthenticated users from accessing any staff function.
- **FR-AUTH-03** The system shall allow students to authenticate to access their own credentials only.
- **FR-AUTH-04** The system shall enforce role checks independently of session authentication (a valid session does not imply authorization for every action).

### 4.2 University Configuration

- **FR-UNI-01** The system shall store a single university's information (name, code, issuer identity).
- **FR-UNI-02** The system shall associate all academic programs with that one university.
- **FR-UNI-03** The system shall associate all staff users with that one university.
- **FR-UNI-04** The system shall not expose any UI or API for creating, switching, or managing multiple universities in the MVP.

### 4.3 Program Management

- **FR-PROG-01** Registrar users shall be able to create academic programs.
- **FR-PROG-02** A program shall contain: name, degree level, field of study.
- **FR-PROG-03** A program shall have associated graduation eligibility rules.
- **FR-PROG-04** Registrar users shall be able to configure the graduation eligibility rules for a program.

### 4.4 Student Management

- **FR-STU-01** The system shall create or update student records from the designated academic source.
- **FR-STU-02** Registrar and Platform Administrator users shall be able to view imported student records and profiles.
- **FR-STU-03** A student record shall contain at minimum: student ID, name, email, program, enrollment/graduation status, and wallet reference.
- **FR-STU-04** Students shall only be able to view their own credentials and profile.
- **FR-STU-05** The system shall treat all student data entered from the Academic Record Source as authoritative input (see AS-01); it shall not perform independent eligibility verification.

### 4.5 Academic Record & Eligibility Evaluation

- **FR-ELIG-01** The system shall receive academic records from the designated academic source.
- **FR-ELIG-02** The system shall associate imported academic records with the corresponding student and academic program.
- **FR-ELIG-03** The system shall evaluate a student's academic record against the graduation eligibility rules applicable to the student's program.
- **FR-ELIG-04** The system shall support rules including, at minimum, required credits, required courses, minimum GPA, and program requirements.
- **FR-ELIG-05** The system shall produce an eligibility result of `ELIGIBLE` or `NOT_ELIGIBLE`.
- **FR-ELIG-06** For a `NOT_ELIGIBLE` result, the system shall identify the mandatory requirements that were not satisfied.
- **FR-ELIG-07** The system shall prevent creation of an issuance request when a student does not satisfy mandatory graduation eligibility rules.
- **FR-ELIG-08** The system shall record the eligibility evaluation result and evaluation timestamp.
- **FR-ELIG-09** Authorized Registrar users shall be able to view the eligibility evaluation for a student.
- **FR-ELIG-10** Changes to eligibility rules shall not retroactively modify previously issued credentials.

### 4.6 Credential Issuance Request & Approval Workflow

- **FR-APPR-01** Registrar users shall be able to create a credential issuance request only for a student whose latest eligibility evaluation has status `ELIGIBLE`, in status `PENDING_APPROVAL`.
- **FR-APPR-02** The system shall prevent credential issuance when the student's eligibility evaluation does not satisfy all mandatory graduation requirements.
- **FR-APPR-03** The system shall support an approval policy defined as "N of M authorized approvers must approve before signing." For the MVP, the active policy shall require exactly **1** approval (N = 1) from any user holding the Approver role.
- **FR-APPR-04** An Approver shall be able to view all requests in `PENDING_APPROVAL` status.
- **FR-APPR-05** An Approver shall be able to approve or reject a pending request, optionally with a comment.
- **FR-APPR-06** When the number of approvals for a request meets the policy's required count, the system shall automatically proceed to credential issuance (FR-CRED-01–06).
- **FR-APPR-07** If a request is rejected by an Approver, the system shall set its status to `REJECTED` and shall not issue a credential for it.
- **FR-APPR-08** The system shall record the identity and timestamp of every approval or rejection decision.
- **FR-APPR-09** The system shall prevent the same user from being counted twice toward the required approval count on a single request.
- **FR-APPR-10** The approval policy shall be configurable by the Platform Administrator (the required count N), even though the MVP ships with N = 1, so the policy can be tightened later without a redesign.

### 4.7 Credential Issuance

- **FR-CRED-01** Upon meeting the approval policy, the system shall issue an academic diploma credential for the associated student.
- **FR-CRED-02** The system shall generate the credential using the configured academic credential schema (see Data_Model.md).
- **FR-CRED-03** The system shall use walt.id as the VC infrastructure for credential issuance into the student's server-managed wallet (see Architecture_Design.md).
- **FR-CRED-04** The application shall maintain its own credential identifier independent of the walt.id credential identifier.
- **FR-CRED-05** A successfully issued credential shall have status `VALID`.
- **FR-CRED-06** The system shall prevent duplicate issuance of the same diploma unless explicitly performing a reissuance (see 4.10).

### 4.8 Credential Viewing

- **FR-CRED-07** Students shall be able to view their issued credentials.
- **FR-CRED-08** Credential details shall include: graduate name, degree, program, field of study, university, award date, and credential status.

### 4.9 Credential Revocation

- **FR-CRED-09** Authorized Registrar users shall be able to revoke a credential.
- **FR-CRED-10** A revoked credential shall no longer be presented as valid by any verification.
- **FR-CRED-11** The system shall record: revocation timestamp, revoking user, revocation reason.

### 4.10 Credential Reissuance

- **FR-CRED-12** The system shall support issuing a corrected credential after revocation, subject to the same approval workflow as a new issuance (4.6).
- **FR-CRED-13** The new credential shall reference the credential it supersedes.

### 4.11 Credential Sharing

- **FR-SHARE-01** Students shall be able to create a verification share for an active (`VALID`) credential.
- **FR-SHARE-02** The system shall generate an opaque share token.
- **FR-SHARE-03** The public share URL shall not expose internal student ID, wallet ID, credential database ID, or authentication credentials.
- **FR-SHARE-04** The student shall be able to specify a share expiration time.
- **FR-SHARE-05** The system shall reject verification attempts against an expired share.
- **FR-SHARE-06** Students shall be able to revoke an active share.
- **FR-SHARE-07** The system shall maintain share history per credential.

### 4.12 Public Verification

- **FR-VER-01** The system shall allow an unauthenticated verifier to access a valid share URL.
- **FR-VER-02** The system shall determine whether the referenced share is valid, expired, or revoked.
- **FR-VER-03** The system shall retrieve the credential associated with a valid share.
- **FR-VER-04** The system shall perform VC verification through the VC infrastructure.
- **FR-VER-05** The system shall verify the credential's issuer.
- **FR-VER-06** The system shall verify credential status.
- **FR-VER-07** The system shall return one of the following results in a human-readable form: `VERIFIED`, `REVOKED`, `EXPIRED_SHARE`, `INVALID_CREDENTIAL`, `UNKNOWN_ISSUER`, `VERIFICATION_ERROR`.
- **FR-VER-08** The public verification result shall present a plain-language summary, not the raw VC, as the default UI.

### 4.13 Audit Logging

- **FR-AUD-01** The system shall record credential issuance requests and their outcome.
- **FR-AUD-02** The system shall record approval/rejection decisions.
- **FR-AUD-03** The system shall record credential revocation events.
- **FR-AUD-04** The system shall record share creation and revocation.
- **FR-AUD-05** The system shall record verification attempts.
- **FR-AUD-06** All audit records shall include timestamps and the acting user (or "anonymous" for verifier events).
- **FR-AUD-07** The system shall record academic record import events.
- **FR-AUD-08** The system shall record eligibility evaluation events, including the student, evaluated program/rule set, result, and timestamp.
- **FR-AUD-09** The system shall record user management events including staff account creation, role assignment, updates, and deactivations.
- **FR-AUD-10** The system shall record student wallet provisioning and re-provisioning events.

### 4.14 User Management

- **FR-USER-01** Platform Administrator users shall be able to create university staff accounts and assign one or more roles (`REGISTRAR`, `APPROVER`, `ADMIN`).
- **FR-USER-02** Platform Administrator users shall be able to view, update profile details of, and deactivate staff accounts.
- **FR-USER-03** Platform Administrator users shall be able to modify the assigned roles of existing staff accounts.
- **FR-USER-04** Registrar and Platform Administrator users shall be able to list and view student user accounts and their current status (`ACTIVE`, `GRADUATED`, `INACTIVE`).
- **FR-USER-05** The system shall prevent deactivation or role removal of the last active Platform Administrator account.

### 4.15 Student Wallet Management

- **FR-WAL-01** The system shall automatically provision a server-managed custodial wallet (via walt.id Wallet API) for a student upon record import if no wallet exists for that student.
- **FR-WAL-02** Platform Administrator and Registrar users shall be able to trigger manual wallet provisioning or re-provisioning for a student whose wallet is missing or in a failed state.
- **FR-WAL-03** The system shall store the provisioned `wallet_id` and maintain wallet status (`PENDING`, `ACTIVE`, `FAILED`) on the student record.
- **FR-WAL-04** The system shall require a student to have an active provisioned wallet before executing credential issuance (FR-CRED-01).

---

## 5. External Interface Requirements

Full endpoint contracts are specified in `API_Specification.md`. At the SRS level:

- The system shall expose a REST API consumed by three front-ends: a University (Registrar/Approver/Admin) portal, a Student portal, and a Public Verification portal.
- The Public Verification portal shall function without any authenticated session.
- The frontend shall never call walt.id directly; all VC and wallet operations shall be mediated by the application's own API (see Architecture_Design.md, NFR-05).

---

## 6. Non-Functional Requirements

**NFR-01 — Security**
The system shall use HTTPS in deployment; authenticated sessions for privileged users; authorization checks on every privileged action; opaque, unguessable share tokens; and shall never expose internal database identifiers in public URLs or store private keys in application source code.

**NFR-02 — Privacy**
The public verification page shall expose only the credential fields required to communicate a verification result (Section 4.11), and no more.

**NFR-03 — Usability**
A verifier shall be able to complete verification without account registration or prior training.

**NFR-04 — Performance**
Under normal prototype conditions, verification shall return a result within several seconds.

**NFR-05 — Maintainability**
The business/domain layer shall not depend directly on walt.id-specific APIs or data structures (see Architecture_Design.md).

**NFR-06 — Auditability**
Every credential issuance shall be traceable to the academic record evaluation, eligibility result, issuance request, approval decision, student wallet, and resulting credential. (Academic Record Imported → Wallet Provisioned → Eligibility Evaluated → Eligible → Issuance Requested → Approved → Issued) or (Academic Record Imported → Not Eligible → No Issuance).

**NFR-07 — Data trust and verification boundary**
The system shall distinguish among (1) academic records trusted as authentic when received from the designated academic source, (2) graduation eligibility determined by applying configured business rules to those records, and (3) cryptographic credential authenticity and status guaranteed through VC verification. The verification result shall not imply that UniDipVeri independently authenticated the underlying academic records.

---

## 7. Data Requirements

The entity model (University, UniversityStaff, Program, Student, AcademicRecord, EligibilityRuleSet, EligibilityEvaluation, CredentialSchema, CredentialIssuanceRequest, CredentialApproval, ApprovalPolicy, Credential, Share, VerificationEvent) and its ERD are specified in `Data_Model.md`. At the SRS level, the system shall persist the entities implied by Sections 4.2–4.15 with sufficient fidelity to satisfy the audit requirements in Section 4.13 and NFR-06.

---

## 8. Acceptance Criteria

- **AC-01 — Request & Approve.** Given an eligible student with an active wallet, when a Registrar creates an issuance request and the required number of Approvers (1, in the MVP) approve it, then a valid VC-backed credential is created.
- **AC-02 — Eligibility evaluation.** Given a student with trusted academic records, when the system evaluates the student's record against the applicable program rules, then the system produces an `ELIGIBLE` or `NOT_ELIGIBLE` result and identifies failed requirements when applicable.
- **AC-03 — Ineligible student.** Given a student who fails a mandatory graduation requirement, when a Registrar attempts to create an issuance request, then the system prevents the request from being created.
- **AC-04 — Eligible student.** Given a student who satisfies all mandatory graduation requirements, when a Registrar creates an issuance request, then the request enters `PENDING_APPROVAL`.
- **AC-05 — Rejection.** Given a pending issuance request, when an Approver rejects it, then no credential is issued and the request is marked `REJECTED`.
- **AC-06 — Student access.** Given a student with an issued credential, when they log in, then they can view the credential.
- **AC-07 — Share.** Given an active credential, when the student creates a share, then the system generates an opaque public URL with an expiration time.
- **AC-08 — Verification.** Given an active share, when an unauthenticated verifier opens it, then the system verifies the credential and displays the relevant information.
- **AC-09 — Revocation.** Given a revoked credential, when a verifier attempts verification, then the system displays `REVOKED`.
- **AC-10 — Expired share.** Given an expired share, when a verifier opens it, then credential information is not displayed and the system reports `EXPIRED_SHARE`.
- **AC-11 — Reissue.** Given a revoked credential requiring correction, when the Registrar requests reissuance and it is approved, then a new valid credential is created and linked to the previous credential.
- **AC-12 — Single tenant.** The system does not expose any function for creating or switching between universities.
- **AC-13 — Trust boundary.** The verification result never implies that UniDipVeri independently re-checked the graduate's academic performance; it only attests to credential authenticity and status.
- **AC-14 — User management.** Given an authenticated Platform Administrator, when they create a staff account and assign a role, then the user can authenticate and perform only actions permitted by that role.
- **AC-15 — Student wallet provisioning.** Given a newly imported student record, when the system processes the record, then a server-managed custodial wallet is created via walt.id, linked to the student with status `ACTIVE`.

---

## 9. Glossary

- **VC (Verifiable Credential):** A cryptographically signed digital claim about a subject, issued by an authority (here, MIU), per the W3C VC data model.
- **Server-Managed Wallet:** A custodial cryptographic wallet identity managed on the backend by walt.id Wallet API on behalf of a student, requiring no client wallet app installation.
- **Share:** A time-boxed, revocable, unguessable public link a student generates to let a third party verify one credential.
- **Approval policy:** The rule governing how many authorized Approvers must sign off before a requested credential is actually issued.
- **Issuer:** The entity (MIU) whose cryptographic identity signs issued credentials, as configured in walt.id.
