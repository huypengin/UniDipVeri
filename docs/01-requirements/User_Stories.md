# User Stories

**Version:** 2.0

Companion to `repo/docs/01-requirements/SRS.md` (v2.0) and `repo/docs/01-requirements/Use_Cases.md`. Stories are grouped into epics matching the SRS's functional sections, written in standard "As a / I want / so that" form with Given/When/Then acceptance criteria, and traced back to requirement IDs. All stories below are in scope for the MVP unless marked otherwise.

---

## Epic A — Authentication & Access

**US-A1.** As a Registrar, I want to log in with my staff credentials, so that I can access university-side functions.

- _AC:_ Given valid credentials, when I submit them, then I receive an authenticated session scoped to my role.
- _AC:_ Given invalid credentials, when I submit them, then I am denied access and no session is created.
- _Traces to:_ FR-AUTH-01, FR-AUTH-02

**US-A2.** As a Student, I want to log in, so that I can view only my own credentials.

- _AC:_ Given I am authenticated, when I request another student's credential, then the system denies it.
- _Traces to:_ FR-AUTH-03, FR-STU-04

**US-A3.** As the system, I want to enforce role checks on every privileged action independent of session state, so that a valid login never implies access to actions outside my role.

- _AC:_ Given I am logged in as Registrar, when I attempt an Approver-only action, then the system rejects it.
- _Traces to:_ FR-AUTH-04

---

## Epic B — Academic Record Import

**US-B1.** As the Academic Record Source, I want to submit a student's academic record to UniDipVeri, so that the university has an up-to-date basis for issuance decisions.

- _AC:_ Given a valid record payload for a known program, when it is submitted, then the student's `STUDENT` and `ACADEMIC_RECORD` entries are created or updated.
- _AC:_ Given a record referencing an unknown program, when it is submitted, then the import is rejected.
- _Traces to:_ FR-STU-01–03, AS-01

**US-B2.** As the system, I want every successful import to automatically trigger an eligibility evaluation, so that Registrars always see a current eligibility status without a manual step.

- _AC:_ Given a record import succeeds, when it completes, then a new `ELIGIBILITY_EVALUATION` is produced for the affected student/program.
- _Traces to:_ FR-ELIG-01–02

**US-B3.** As a Registrar, I want imported student and academic data to be read-only to me, so that I never accidentally introduce data the system should be treating as trusted, external input.

- _AC:_ Given I am a Registrar, when I look for a "create/edit academic record" action, then none exists — only import (US-B1) can create or change this data.
- _Traces to:_ AS-01, Architecture_Design.md §2

---

## Epic C — Program & Eligibility Rules

**US-C1.** As a Registrar, I want to create and edit academic programs, so that students and credentials can be organized by program.

- _AC:_ Given I submit a program name, degree level, and field of study, when I save, then the program appears in the program list under MIU.
- _Traces to:_ FR-PROG-01, FR-PROG-02

**US-C2.** As a Registrar, I want to define graduation eligibility rules for a program (minimum credits, minimum GPA, required courses), so that eligibility can be checked automatically instead of manually.

- _AC:_ Given a program, when I save a new rule set, then it becomes the active rule set for future evaluations, versioned separately from any prior rule set.
- _Traces to:_ FR-PROG-03, FR-PROG-04, FR-ELIG-04

**US-C3.** As a Registrar, I want past eligibility evaluations to keep referencing the rule version they were run against, so that editing today's rules never silently changes yesterday's decisions.

- _AC:_ Given a rule set is edited, when I open a historical evaluation made under the old rules, then it still reflects the old rule set's outcome.
- _Traces to:_ FR-ELIG-10

---

## Epic D — Eligibility Evaluation

**US-D1.** As a Registrar, I want the system to evaluate a student's record against their program's rules, so that I know whether they qualify for a diploma before I try to issue one.

- _AC:_ Given a student meets all mandatory rules, when evaluated, then the result is `ELIGIBLE`.
- _AC:_ Given a student fails at least one mandatory rule, when evaluated, then the result is `NOT_ELIGIBLE` and the specific failed requirement(s) are listed.
- _Traces to:_ FR-ELIG-03–06

**US-D2.** As a Registrar, I want to view a student's latest eligibility result and any failed requirements, so that I can explain to the student what's outstanding.

- _AC:_ Given a `NOT_ELIGIBLE` result, when I open the student's eligibility view, then I see each failed requirement with its expected and actual values.
- _Traces to:_ FR-ELIG-09

---

## Epic E — Credential Issuance & Approval

**US-E1.** As a Registrar, I want to request diploma issuance only for students who are currently eligible, so that ineligible students can never enter the issuance pipeline.

- _AC:_ Given a student's latest evaluation is `NOT_ELIGIBLE`, when I try to create an issuance request, then the system refuses and shows why.
- _AC:_ Given a student is `ELIGIBLE`, when I create a request, then it enters `PENDING_APPROVAL` linked to that evaluation.
- _Traces to:_ FR-APPR-01, FR-APPR-02

**US-E2.** As an Approver, I want to see all pending issuance requests, so that I can review and act on them.

- _AC:_ Given one or more requests are `PENDING_APPROVAL`, when I open my queue, then I see all of them with student and program context.
- _Traces to:_ FR-APPR-04

**US-E3.** As an Approver, I want to approve or reject a pending request with an optional comment/reason, so that my decision and its rationale are on record.

- _AC:_ Given a pending request, when I approve it, then my decision, identity, and timestamp are recorded.
- _AC:_ Given a pending request, when I reject it with a reason, then the request becomes `REJECTED` and no credential is issued.
- _Traces to:_ FR-APPR-05, FR-APPR-07, FR-APPR-08

**US-E4.** As the system, I want to require a configurable number of approvals (defaulting to 1) before issuing a credential, so that issuance always has explicit sign-off, and the policy can be tightened later without a redesign.

- _AC:_ Given the active policy requires 1 approval, when a single Approver approves, then issuance is triggered automatically.
- _AC:_ Given the same user tries to approve a request twice, when the second approval is submitted, then it does not count twice toward the required total.
- _Traces to:_ FR-APPR-03, FR-APPR-06, FR-APPR-09

**US-E5.** As a Platform Administrator, I want to configure the required number of approvals, so that MIU can move beyond a single approver in the future without code changes.

- _AC:_ Given I set required approvals to a new value, when a new request is created afterward, then it uses the new threshold.
- _Traces to:_ FR-APPR-10

**US-E6.** As the system, I want to issue the VC through walt.id only after a request is fully approved, so that no credential ever exists without a recorded, eligible, approved request behind it.

- _AC:_ Given a request reaches its required approval count, when issuance runs, then a `CREDENTIAL` is created with status `VALID` and the request becomes `ISSUED`.
- _Traces to:_ FR-CRED-01–06

**US-E7.** As the system, I want to prevent duplicate issuance for the same diploma outside of an explicit reissuance, so that a student can't end up with two live credentials for the same award.

- _AC:_ Given an active or already-issued request exists for a student/credential type, when a new non-reissuance request is attempted, then it is refused.
- _Traces to:_ FR-CRED-06

---

## Epic F — Credential Lifecycle (View / Revoke / Reissue)

**US-F1.** As a Student, I want to view my issued credentials with full details, so that I can confirm what was issued to me.

- _AC:_ Given I have an issued credential, when I open my credential list, then I see graduate name, degree, program, field of study, university, award date, and status.
- _Traces to:_ FR-CRED-07, FR-CRED-08

**US-F2.** As a Registrar, I want to revoke a credential with a reason, so that incorrect or invalidated diplomas stop verifying as valid.

- _AC:_ Given a valid credential, when I revoke it with a reason, then future verification attempts return `REVOKED`, and the reason, actor, and timestamp are recorded.
- _Traces to:_ FR-CRED-09–11

**US-F3.** As a Registrar, I want to reissue a corrected credential after revocation, so that a mistake can be fixed without losing the historical record.

- _AC:_ Given a revoked credential and a currently-eligible student, when I request reissuance and it is approved, then a new `VALID` credential is created that references the credential it supersedes.
- _AC:_ Given the student is no longer eligible under current rules, when I attempt reissuance, then it cannot proceed.
- _Traces to:_ FR-CRED-12–13, FR-ELIG-10

---

## Epic G — Credential Sharing

**US-G1.** As a Student, I want to generate a time-limited public link for one of my credentials, so that I can let an employer verify it without giving them my login or exposing internal IDs.

- _AC:_ Given a valid credential, when I create a share with an expiration date, then I receive an opaque public URL that reveals no internal student, wallet, or credential database identifiers.
- _Traces to:_ FR-SHARE-01–04

**US-G2.** As a Student, I want to revoke a share I no longer want active, so that I can cut off access at any time, independent of the original expiration.

- _AC:_ Given an active share, when I revoke it, then subsequent verification attempts against it fail.
- _Traces to:_ FR-SHARE-06

**US-G3.** As a Student, I want to see the history of shares I've created, so that I know who I've given access to and for how long.

- _AC:_ Given I have created one or more shares, when I open my share history, then I see each share's purpose, status, and expiration.
- _Traces to:_ FR-SHARE-07

---

## Epic H — Public Verification

**US-H1.** As a Verifier, I want to open a share link without creating an account, so that checking a candidate's diploma takes no setup.

- _AC:_ Given a valid, unexpired, unrevoked share link, when I open it, then I can immediately request verification.
- _Traces to:_ FR-VER-01, NFR-03

**US-H2.** As a Verifier, I want a clear, plain-language verification result, so that I don't have to interpret a raw cryptographic credential.

- _AC:_ Given a valid credential behind an active share, when I verify it, then I see a `VERIFIED` result with graduate name, degree, program, institution, and award date — not the raw VC.
- _Traces to:_ FR-VER-04–08

**US-H3.** As a Verifier, I want distinct, understandable outcomes for expired links and revoked credentials, so that I know why a check didn't succeed.

- _AC:_ Given an expired share, when I attempt verification, then I see `EXPIRED_SHARE` and no credential details.
- _AC:_ Given a revoked credential, when I attempt verification, then I see `REVOKED`.
- _Traces to:_ FR-VER-02, FR-VER-07

**US-H4.** As a Verifier, I want the verification result to only speak to the credential's authenticity and status, so that I understand it is not a re-check of the graduate's actual academic performance.

- _AC:_ Given any verification result, when I read it, then nothing in the response implies UniDipVeri re-validated grades, courses, or eligibility — only credential status.
- _Traces to:_ NFR-07

---

## Epic I — Audit & Traceability

**US-I1.** As a Registrar, I want a full, timestamped audit trail of import, evaluation, approval, issuance, and revocation events, so that any credential's history can be reconstructed for review.

- _AC:_ Given a credential exists, when I view its audit trail, then I can see the chain: record imported → eligibility evaluated → request created → approved/rejected → issued (and revoked/reissued, if applicable).
- _Traces to:_ FR-AUD-01–08, NFR-06

**US-I2.** As a Student, I want to see my own share and verification-event history, so that I know when and how my credentials were checked.

- _AC:_ Given I have shared a credential, when I open my verification events, then I see each verification attempt against my shares.
- _Traces to:_ FR-AUD-05

---

## Backlog Prioritization (MVP Build Order)

1. **Foundation:** US-A1–A3, US-C1 (auth + programs must exist before anything else)
2. **Trust boundary:** US-B1–B3, US-C2–C3, US-D1–D2 (import + eligibility before any issuance is possible)
3. **Core workflow:** US-E1–E7 (the request/approval/issuance pipeline — this is the thesis's central contribution)
4. **Graduate-facing value:** US-F1–F3, US-G1–G3 (credential lifecycle + sharing)
5. **The payoff:** US-H1–H4 (public verification — this is what proves the research question)
6. **Supporting:** US-I1–I2 (audit views — can be trimmed first if time is short, per Architecture_Design.md)

This order intentionally puts eligibility and the request/approval chain before public verification, even though verification is the user-visible "wow" feature — without a trustworthy issuance pipeline behind it, the verification result has nothing credible to report.
