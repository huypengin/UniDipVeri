# Software Requirements Specification — UniDipVeri

**Version:** 0.4.0

**Project type:** Undergraduate thesis prototype

**Institution:** Mekong International University (fictional)

**Primary domain:** Academic credential issuance and verification

**VC infrastructure:** walt.id Community Stack (see Architecture_Design.md)

**Deployment model:** Single university, single tenant

**Companion documents** (not part of this SRS):

- `docs/03-design/Architecture_Design.md` — system architecture, layering, VC adapter, system boundary
- `docs/03-design/Data_Model.md` — ERD and schema definitions
- `docs/04-api/API_Specification.md` — REST endpoint contracts

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

UniDipVeri is a new, self-contained system. It integrates with walt.id for VC issuance and verification but owns its own domain model (users, students, programs, credentials, shares, audit log) independently of walt.id's internal representations. UniDipVeri receives academic records from an authoritative academic source system. Source academic records are assumed to be correct and authentic at the point of import. UniDipVeri does not independently authenticate individual grades or transcript entries. Instead, it evaluates imported academic data against configured graduation eligibility rules. Platform Administrators manage university staff accounts and roles. The system provisions server-managed wallets for students to hold credentials. Registrar users review and initiate credential issuance requests, while authorized Approvers authorize issuance before the credential is cryptographically issued. Because student data enters the system only through the trusted Academic Record Source (AS-01), there is no student-initiated "apply to graduate" step; graduation candidacy is determined entirely by evaluating imported records against configured eligibility rules, not by a separate application workflow.

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

**Note on the Approver role and real institutional graduation councils:**
In practice, Vietnamese universities (including MIU) convene a graduation council — a fixed, named body that meets as a session to review and vote on a cohort of candidates together, producing a single meeting record covering many students at once. UniDipVeri's `ApprovalPolicy` (N of M) is a simplified analogue of this: any staff member holding the `APPROVER` role may cast an independent decision on any pending request, asynchronously and in any order, until N distinct approvals accumulate. It does not model fixed council membership per session, batch/session-level voting, meeting minutes, or quorum tied to a specific convened session. This simplification is intentional and scoped for the MVP (see §3.2); a full council model is reserved for future work.

### 2.4 Operating Environment

Web application (server-rendered or SPA) served over HTTPS, backed by an application database and the walt.id Community Stack, deployable as a single-instance prototype (no high-availability requirement).

### 2.5 Assumptions and Dependencies

- **AS-01 — Source academic record trust:** Academic records received from the designated academic source system are assumed to be authentic and correct at the time of import. UniDipVeri does not independently verify the authenticity of individual grades, courses, or transcript entries. It verifies that a credential was issued by MIU and has not been revoked or altered, not that the underlying academic claim is true. Correctness of source data is the responsibility of the Registrar/University, not the system.
- **AS-02 — Single tenant:** The system is built and deployed for exactly one university (MIU). It is not designed to support multiple issuing institutions in the MVP (see 3.2).
- **AS-03 — University-wide Staff Authorization Scope:** The system assumes that University Staff members assigned the `REGISTRAR` or `APPROVER` role operate at the university level and are not restricted to a specific academic program or department. A `REGISTRAR` may manage or review academic records, review eligibility evaluations, and initiate credential issuance requests for students enrolled in any program offered by the university. An `APPROVER` may review and approve or reject credential issuance requests for students enrolled in any program offered by the university, subject to the university's configured approval policy. Program or department specific authorization for these roles is outside the scope of the current system and may be introduced in a future version if such organizational requirements are identified.
- **AS-04 — VC Infrastructure Preconfiguration & Status Hosting:** walt.id services (Issuer, Wallet, Verifier) are deployed and statically preconfigured by the developer/DevOps before the system starts. This includes loading the issuer profile in walt.id's `issuer2-profiles.conf` (e.g., `AcademicDiploma_jwt_vc_json`), registering MIU's issuer signing key material (JWK/DID), and configuring issuer metadata. UniDipVeri references these preconfigured profile IDs at runtime rather than creating or modifying cryptographic profiles dynamically through an in-app admin UI. Because the walt.id Community Stack does not include a managed credential status list service, UniDipVeri manages credential status in its own database and hosts the W3C Bitstring Status List endpoint, passing status list references to walt.id during issuance.
- **AS-05 — Modern Browser Access:** Users access the system over a modern browser with JavaScript enabled.
- **AS-06 — Eligibility rules:** Graduation eligibility rules configured for each academic program are assumed to accurately represent the university's graduation requirements.
- **AS-07 — Credentials do not expire:** An issued academic diploma credential (`Credential`) has no validity window or expiration date of its own; once issued, it remains `VALID` indefinitely unless explicitly revoked via `CredentialService.revoke()` (FR-CRED-09–11). This reflects the real-world nature of an academic diploma, which does not lapse over time the way a certification or license might. Expiration in this system applies only to **share links** (`Share.expires_at`, FR-SHARE-04–05, `EXPIRED_SHARE` result) — never to the credential itself. A future extension requiring time-bound credentials (e.g., provisional or conditional diplomas) would need a new `Credential.expires_at` field and a corresponding `EXPIRED` status, which is explicitly out of scope for the MVP.
- **AS-08 — Deployment-scoped role-combination and self-approval policy:** By default, the system shall not permit a single `UNIVERSITY_STAFF` account to hold both `REGISTRAR` and `APPROVER` roles simultaneously, since that combination allows one individual to both request and approve credential issuance, undermining the independent-approval guarantee described in FR-APPR-01–10. For constrained-staffing deployments (e.g., this MVP thesis prototype, or a small pilot with limited staff), this restriction — and the correspondingly relaxed self-approval check in FR-APPR-11 — may be overridden via a deployment-time configuration flag (e.g., an environment variable or `appsettings.json` entry, not a database column or in-app setting). This flag is read once at deployment/boot time; no authenticated session, including Platform Administrator, can change it at runtime. This follows the same principle as AS-04's deployment-time preconfiguration of walt.id issuer profiles: trust-sensitive controls are provisioned outside the running application, not exposed as in-app settings — otherwise an Admin-role account could grant itself an approval bypass on demand.

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
- Dynamic in-app walt.id profile/schema administration (e.g., runtime UI for editing `issuer2-profiles.conf` or uploading signing keys). The credential profile is preconfigured at deployment time (see AS-03).
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
- Integration with a specific production Student Information System (SIS). The MVP shall use the designated academic record source through the defined academic-record ingestion boundary; implementing a live integration with a specific university SIS is reserved for Future Work.
- Manual override of a student's graduation status outside the automated eligibility engine (e.g. denying graduation for disciplinary or integrity reasons). `Student.graduation_status = REJECTED` is modeled in the data layer for future extension but has no MVP trigger.
- Withdrawal or cancellation of a `PENDING_APPROVAL` credential issuance request by the Registrar who created it. Once created, a request can only be resolved by an Approver's decision (approve or reject); correcting a mistaken request requires an Approver rejection followed by a new, correct request.
- Automatic expiration, reminder, or escalation of a `PENDING_APPROVAL` request that no Approver has acted on. Requests remain pending indefinitely until an Approver decides; monitoring for stale requests is an operational/reporting concern, not an enforced system behavior, in the MVP.
- Push notifications or email alerts for any workflow event (new pending request, approval decision, degree conferral, credential issuance, revocation). The MVP is pull-based: actors discover state changes by logging into their respective portal and viewing the relevant list or dashboard.
- Re-validation of eligibility between approval and issuance. If a source re-import (UC-03) updates a student's academic record after their issuance request has already met its approval threshold, the system does not re-check eligibility or block conferral/issuance already in progress. Eligibility is only checked at request creation time (FR-APPR-01, FR-APPR-02).
- A student-facing "apply to graduate" workflow. Eligibility evaluation is triggered automatically by record import or manual Registrar re-evaluation (UC-05), not by student self-application.
- Modeling a graduation council as a distinct entity with fixed session membership, batch voting on a cohort in a single sitting, or meeting-minute records. The MVP's `ApprovalPolicy` (N of M) is a simplified, per-request, asynchronous approval count by any staff member holding the `APPROVER` role — not a convened council session.

### 3.3 Thesis Contribution Boundary

The thesis contribution is the design and implementation of the UniDipVeri application layer and its associated user-facing workflows for academic credential issuance and verification. This contribution includes university staff and role management; server-managed student wallet orchestration; academic-record ingestion and graduation-eligibility evaluation; eligibility-gated and approval-gated credential issuance; credential lifecycle management including issuance, revocation, and reissuance; short-lived credential sharing; public credential verification; audit logging; and evaluation of the resulting workflow.

The authoritative academic record source is an external dependency and is outside the implementation scope of this thesis. UniDipVeri assumes that academic records received from the designated source are authentic and correct at the point of import, as defined in AS-01. The system does not independently authenticate individual grades, courses, enrollment records, or other underlying academic claims.

walt.id is an external VC infrastructure dependency. It provides the underlying wallet, credential issuance, cryptographic signing, and verification mechanisms used by UniDipVeri. UniDipVeri is responsible for orchestrating these capabilities through its own application interfaces and domain model; the thesis does not implement custom cryptographic primitives or replace walt.id's VC infrastructure. Because walt.id Community Stack does not include a hosted revocation list service out of the box, UniDipVeri manages credential revocation status in its domain store and hosts the W3C status list endpoint consumed by verifiers.

The MVP scope is intentionally limited to a single university and a server-managed, self-service verification workflow. Multi-university support, student-facing holder-interactive OID4VP, multi-step or sequential approval chains, batch academic-record processing, batch eligibility evaluation, batch approval, and integration with a specific production Student Information System (SIS) are outside the MVP scope and are reserved for Future Work.

This boundary is frozen for the MVP. These exclusions are scope decisions rather than implementation deficiencies and shall not be treated as missing MVP requirements.

### 3.4 Baseline: Manual Workflow Comparison

To motivate the problem statement in Section 1.2, this subsection places UniDipVeri's two central workflows (eligibility gated issuance and public verification) side by side with the manual process they replace at a typical university. This grounds the thesis contribution in a real operational baseline rather than an assumed one, and shows that the approval gate in Section 4.6 mirrors an existing institutional control rather than introducing a new one.

#### 3.4.1 Issuance Baseline

| Stage                                 | UniDipVeri (this system)                                                                                                                                  | Manual counterpart                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Record intake                         | Academic Record Source submits a trusted payload (UC-03)                                                                                                  | Grades post; registrar staff assemble the candidate's record                                             |
| Eligibility check                     | `EligibilityService.evaluate` applies a versioned rule set (UC-05)                                                                                        | Degree audit checks credits, GPA, residency, course requirements [1]                                     |
| Issuance request / precondition check | Registrar creates a request; system validates a `CREDENTIAL_SCHEMA` exists for the credential type (UC-07)                                                | No direct equivalent; the paper process does not have an equivalent machine-enforced schema precondition |
| Program/department approval           | Configured approvers provide N-of-M approval per ApprovalPolicy (FR-APPR-03, UC-08)                                                                       | Department/program reviews and clears the candidate, followed by independent registrar review [1][2]     |
| **Conferral**                         | `IssuanceRequestService.conferDegree` sets `graduation_status = GRADUATED` once the threshold is met, durable and independent of VC creation (FR-CONF-01) | Degree is marked conferred on the transcript [3]                                                         |
| Credential issuance                   | `CredentialService.issue` builds and signs the VC via walt.id; failure here does not affect conferral (FR-CONF-03)                                        | Diploma record is generated from the conferred degree and sent to a print vendor [3]                     |
| Delivery                              | Credential is immediately available in the student portal (UC-11)                                                                                         | Diploma is printed, checked, and mailed, three to eight weeks later [3][4][5]                            |

This comparison supports three claims worth stating explicitly in Section 1.2:

- The approval workflow in Section 4.6 is not an invented control. Rice University's certification process already routes degree candidates through a departmental or program level petition and approval, followed by a second, independent internal review performed by the Office of the Registrar [2]. UniDipVeri's `ApprovalPolicy` formalizes an existing two party review pattern rather than adding bureaucracy that did not previously exist.
- The multi week gap between conferral and physical diploma delivery is a real, cited cost that UniDipVeri's near instant issuance (NFR-04) is designed to eliminate. University at Buffalo reports diplomas mailed approximately three to six weeks after conferral [4]; Columbia reports five to eight weeks depending on domestic or international delivery [5]; Mercy University reports up to three months [3].
- Conferral and credential issuance are modeled as two distinct, independently durable acts (FR-CONF-01 through FR-CONF-03), reflecting the distinction in the manual process between recording the degree as conferred and subsequently producing the physical diploma. A delay or failure in credential production therefore does not put the recorded fact of graduation in question.

**Sources:**

[1] Rice University, Graduation Certification Process — https://registrar.rice.edu/facstaff/grad-certification-process  
[2] Rice University, Graduation Certification Process (departmental/GPS petition review followed by Office of the Registrar's second internal review) —https://registrar.rice.edu/facstaff/grad-certification-process  
[3] Mercy University, Degree Conferral Procedures — https://mercy.edu/student-support/office-registrar/degree-conferral-procedures  
[4] University at Buffalo, Undergraduate Degree Application & Conferral — https://www.buffalo.edu/registrar/degree-conferral/undergraduate-degree-application-conferral.html  
[5] Columbia University, Graduation Checklist / University Registrar — https://registrar.columbia.edu/content/graduation-requirements-and-diplomas

#### 3.4.2 Verification Baseline

| Stage                    | UniDipVeri (this system)                                                                                                                                      | Manual counterpart                                                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verifier initiates check | Opens a self service share link (UC-14, FR-VER-01)                                                                                                            | Contacts the registrar's office directly by phone, email, or fax, or goes through a third party clearinghouse [6][7]                                                                                                                                             |
| Turnaround               | Seconds (NFR-04)                                                                                                                                              | Direct registrar contact: five to seven business days on average, up to ten to fifteen during peak periods such as graduation season [6]. Automated clearinghouse queries: twenty four to forty eight hours for participating institutions [8]                   |
| Trust mechanism          | Cryptographic issuer and status check delegated to walt.id (FR-VER-04 to FR-VER-06)                                                                           | Human staff member manually confirms name, attendance dates, and degree conferred against internal records [7][9]                                                                                                                                                |
| Verifier access          | Any verifier possessing a valid share link can perform the check without an account or prior relationship with the issuer                                     | A nationwide clearinghouse processes over a billion verification requests annually across thousands of participating institutions, but non participating schools and foreign institutions still require direct contact or separate credential evaluation [8][10] |
| Fraud exposure           | Cryptographic integrity: A modified or improperly signed VC fails issuer/signature validation; a revoked or otherwise invalid credential fails status checks. | Industry sources report roughly a third of job applicants misrepresent educational credentials, and note diploma mills as a persistent, human scale verification problem [6][11]                                                                                 |

This comparison is useful for two reasons beyond turnaround time:

- It shows that a centralized trust broker for verification already exists in practice. Georgia State University's registrar office names its relationship with a nationwide clearinghouse explicitly, delegating verification on the university's behalf rather than answering every inquiry directly [10]. UniDipVeri's public verification portal is best framed as a decentralized, institution owned alternative to that same need, not as a wholly new category of service.
- It shows the gap the clearinghouse model itself does not close: institutions outside the clearinghouse network, and credentials issued abroad, still fall back to slow manual contact or third party credential evaluation services such as NACES member organizations [9]. This is the gap a self verifying, cryptographically signed credential is positioned to close without requiring universal enrollment in a shared database.

**Sources:**

[6] SimpliVerified, How to Validate Degrees and Diplomas: The 2026 Employer Guide — https://simpliverified.com/news/how-to-validate-degrees-and-diplomas-the-2026-employer-guide  
[7] Proof of Education for Employment, ValidGrad — https://validgrad.com/blog/proof-of-education-employment/  
[8] SimpliVerified, How to Validate Degrees and Diplomas: The 2026 Employer Guide (National Student Clearinghouse volume and turnaround) — https://simpliverified.com/news/how-to-validate-degrees-and-diplomas-the-2026-employer-guide  
[9] iprospectcheck, Education Verification for Employment: A Complete Guide — https://iprospectcheck.com/education-verification/ (foreign credential evaluation via NACES member organizations)  
[10] Georgia State University, Degree Conferral and Diploma Information — https://registrar.gsu.edu/degree-conferral-and-diploma-information/  
[11] SimpliVerified, How to Validate Degrees and Diplomas: The 2026 Employer Guide (2023 Employment Screening Benchmark Report figure) — https://simpliverified.com/news/how-to-validate-degrees-and-diplomas-the-2026-employer-guide

**Note on scope:** this subsection is descriptive baseline material for framing the research problem. It does not introduce new functional or non functional requirements, and nothing in Section 4 depends on it. The turnaround figures cited above are third party reported industry figures rather than measurements of any specific institution UniDipVeri models itself on, and should be treated as illustrative context in the thesis writeup rather than as a controlled benchmark. Given how fast this space moves, it would be worth re-checking these figures for currency before final submission.

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
- **FR-PROG-02** A program shall contain: name, full title (e.g., _Bachelor of Science in Computer Science_ or _Bachelor of Computer Science_), degree level.
- **FR-PROG-03** A program shall have associated graduation eligibility rules.
- **FR-PROG-04** Registrar users shall be able to configure the graduation eligibility rules for a program.
- **FR-PROG-05** The system shall validate that a program's full title contains a keyword matching its degree level (e.g., "Bachelor" for `BACHELOR`, "Master" for `MASTER`, "Doctor" for `DOCTORATE`), so that program metadata is internally consistent.

### 4.4 Student Management

- **FR-STU-01** The system shall create or update student records from the designated academic source.
- **FR-STU-02** Registrar and Platform Administrator users shall be able to view imported student records and profiles.
- **FR-STU-03** A student record shall contain at minimum: student ID, name, email, program, account status, graduation status, and wallet reference.
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
- **FR-APPR-11** The system shall, by default, prevent the same staff member from both creating (as Registrar) and approving (as Approver) a given credential issuance request, regardless of role assignment. When deployment-time configuration explicitly permits the `REGISTRAR`+`APPROVER` role combination (FR-USER-06, AS-08), this restriction is correspondingly relaxed for accounts holding both roles. Every such self-approval decision shall nonetheless be flagged on the recorded `CREDENTIAL_APPROVAL` entry and surfaced distinctly in audit views (FR-AUD-02), so that self-approved requests remain visibly traceable regardless of the current policy state.

---

### 4.6a Degree Conferral

- **FR-CONF-01** Upon a credential issuance request meeting its required approval count (FR-APPR-06), the system shall record the degree as officially conferred by setting the student's `graduation_status = GRADUATED`, as an academic decision distinct from, and prior to, producing the Verifiable Credential artifact (FR-CRED-01).
- **FR-CONF-02** Conferral shall be idempotent: conferring a degree for a student whose `graduation_status` is already `GRADUATED` for that program (e.g. during a reissuance) shall not alter the original conferral record.
- **FR-CONF-03** If credential issuance subsequently fails (FR-CRED "Extensions" 3a) after conferral has been recorded, the conferral shall not be rolled back. A conferred degree is an academic fact independent of whether a credential artifact currently exists to attest to it.

---

### 4.7 Credential Issuance

- **FR-CRED-01** Upon meeting the approval policy, the system shall issue an academic diploma credential for the associated student.
- **FR-CRED-02** The system shall generate the credential referencing the preconfigured academic credential schema/profile (see Data_Model.md).
- **FR-CRED-03** The system shall use walt.id as the VC infrastructure for credential issuance into the student's server-managed wallet (see Architecture_Design.md).
- **FR-CRED-04** The application shall maintain its own credential identifier independent of the walt.id credential identifier.
- **FR-CRED-05** A successfully issued credential shall have status `VALID`.
- **FR-CRED-06** The system shall prevent duplicate issuance of the same diploma unless explicitly performing a reissuance (see 4.10).

### 4.8 Credential Viewing

- **FR-CRED-07** Students shall be able to view their issued credentials.
- **FR-CRED-08** Credential details shall include: graduate name, degree, program, university, award date, and credential status.

### 4.9 Credential Revocation

- **FR-CRED-09** Authorized Registrar users shall be able to revoke a credential.
- **FR-CRED-10** A revoked credential shall immediately be recorded as `REVOKED` in the application store and marked revoked in the self-hosted status list, and shall no longer be presented as valid by any verification.
- **FR-CRED-11** The system shall record: revocation timestamp, revoking user, revocation reason.

### 4.10 Credential Reissuance

- **FR-CRED-12** The system shall support issuing a corrected credential after revocation via an application-managed lifecycle workflow, subject to the same approval workflow as a new issuance (4.6).
- **FR-CRED-13** The new credential shall be issued as a distinct Verifiable Credential and shall explicitly reference the superseded credential in the application domain.

**Note:** Reissuance operates on the credential produced by the issuance pipeline; if the defect originates in the source academic record itself, a corrected re-import (§4.5, AS-01) is a precondition for a materially different reissued credential. Reissuance alone cannot correct a defect that originates upstream of the credential subject.

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
- **FR-VER-02** The system shall determine whether the referenced share exists, is valid, expired, or revoked.
- **FR-VER-03** The system shall retrieve the credential associated with a valid share.
- **FR-VER-04** The system shall perform VC verification through the VC infrastructure.
- **FR-VER-05** The system shall verify the credential's issuer.
- **FR-VER-06** The system shall verify credential status (both cryptographic status list integrity and application revocation state).
- **FR-VER-07** The system shall return one of the following results in a human-readable form: `VERIFIED`, `REVOKED`, `NOT_FOUND_SHARE`, `EXPIRED_SHARE`, `REVOKED_SHARE`, `INVALID_CREDENTIAL`, `UNKNOWN_ISSUER`, `VERIFICATION_ERROR`.
- **FR-VER-08** The public verification result shall present a plain-language summary, not the raw VC, as the default UI.
- **FR-VER-09** The system shall not persist a `VERIFICATION_EVENT` for an attempt against a share that is missing/not found, expired, or revoked (`NOT_FOUND_SHARE`, `EXPIRED_SHARE`, `REVOKED_SHARE`), since no resolvable share or credential exists to attribute the event to and such attempts are frequently automated (dead links, bot crawls, stale bookmarks). A `VERIFICATION_EVENT` shall be persisted for every other outcome (`VERIFIED`, `REVOKED`, `UNKNOWN_ISSUER`, `INVALID_CREDENTIAL`, `VERIFICATION_ERROR`), since each of those resolves to a real share/credential worth tracking.

### 4.13 Audit Logging

- **FR-AUD-01** The system shall record credential issuance requests and their outcome.
- **FR-AUD-02** The system shall record approval/rejection decisions.
- **FR-AUD-03** The system shall record credential revocation events.
- **FR-AUD-04** The system shall record share creation and revocation.
- **FR-AUD-05** The system shall record verification attempts.
- **FR-AUD-05a** The student-facing verification history shall group verification events by share, presenting one entry per share with its most recent result, a total attempt count, and the most recent verification timestamp — rather than one row per raw event. (See FR-VER-09 for which outcomes are recorded at all.)
- **FR-AUD-06** All audit records shall include timestamps and the acting user (or "anonymous" for verifier events).
- **FR-AUD-07** The system shall record academic record import events.
- **FR-AUD-08** The system shall record eligibility evaluation events, including the student, evaluated program/rule set, result, and timestamp.
- **FR-AUD-09** The system shall record user management events including staff account creation, role assignment, updates, and deactivations.
- **FR-AUD-10** The system shall record student wallet provisioning and re-provisioning events.

### 4.14 User Management

- **FR-USER-01** Platform Administrator users shall be able to create university staff accounts and assign one or more roles (`REGISTRAR`, `APPROVER`, `ADMIN`).
- **FR-USER-02** Platform Administrator users shall be able to view, update profile details of, and deactivate staff accounts.
- **FR-USER-03** Platform Administrator users shall be able to modify the assigned roles of existing staff accounts.
- **FR-USER-04** The system shall allow Registrar and Platform Administrator users to list and view student profiles, displaying both their:
  - **Account Status:** `PENDING_ACTIVATION`, `ACTIVE`, `INACTIVE` (Default is `PENDING_ACTIVATION` for newly imported data).
  - **Graduation Status:** `NOT_STARTED`, `PENDING_REVIEW`, `ELIGIBLE`, `GRADUATED`, `REJECTED` (Default is `NOT_STARTED`).
- **FR-USER-05** The system shall prevent deactivation or role removal of the last active Platform Administrator account.
- **FR-USER-06** The system shall, by default, prevent a Platform Administrator from assigning both `REGISTRAR` and `APPROVER` roles to the same staff account. This restriction shall only be lifted via deployment-time configuration (see AS-08), never via an in-app control.

### 4.15 Student Wallet Management

- **FR-WAL-01** The system shall automatically provision a server-managed custodial wallet (via walt.id Wallet API) for a student upon record import if no wallet exists for that student.
- **FR-WAL-02** Platform Administrator and Registrar users shall be able to trigger manual wallet provisioning or re-provisioning for a student whose wallet is missing or in a failed state.
- **FR-WAL-03** The system shall store the provisioned `wallet_id` and maintain wallet status (`PENDING`, `ACTIVE`, `FAILED`, `INACTIVE`) on the student record.
- **FR-WAL-04** The system shall require a student to have an active provisioned wallet before executing credential issuance (FR-CRED-01).
- **FR-WAL-05** When a student account is deactivated (`AccountStatus = INACTIVE`), the student's wallet status shall also transition to `INACTIVE`. The system shall prevent credential issuance to any wallet whose status is not `ACTIVE`.

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

**NFR-08 — Verification event noise control**
Raw verification attempts shall be logged in full for audit completeness (FR-AUD-05), but the student-facing verification history (`GET /api/me/verification-events`) shall present a deduplicated, human-readable summary rather than a raw event-by-event log, so that repeated automated checks (e.g. link-preview bots, page refreshes, retries) do not obscure genuine verification activity. The registrar/system-wide audit view (UC-17) is unaffected and continues to reflect the raw event trail.

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
- **AC-10 — Missing, expired, or revoked share.** Given a non-existent, expired, or revoked share, when a verifier opens it, then credential information is not displayed and the system reports `NOT_FOUND_SHARE`, `EXPIRED_SHARE`, or `REVOKED_SHARE` respectively.
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
