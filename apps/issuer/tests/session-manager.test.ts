import { describe, expect, it, beforeEach } from "bun:test";
import {
  SessionManager,
  InvalidGrantError,
  timingSafeCompare,
  generateSecureToken,
} from "../src/services/session-manager.js";

describe("SessionManager OID4VCI Authorization & Session Store", () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
  });

  describe("CSPRNG Token Generation & Constant-Time Comparison", () => {
    it("generates unique tokens with correct prefixes and >=128-bit entropy", () => {
      const code1 = generateSecureToken("poc_", 32);
      const code2 = generateSecureToken("poc_", 32);

      expect(code1).toMatch(/^poc_[A-Za-z0-9_-]{40,}$/);
      expect(code2).toMatch(/^poc_[A-Za-z0-9_-]{40,}$/);
      expect(code1).not.toBe(code2);
    });

    it("verifies timingSafeCompare equality correctly", () => {
      expect(timingSafeCompare("1234", "1234")).toBe(true);
      expect(timingSafeCompare("1234", "1235")).toBe(false);
      expect(timingSafeCompare("1234", "12345")).toBe(false);
      expect(timingSafeCompare("", "")).toBe(true);
    });
  });

  describe("Pre-Authorized Code Issuance", () => {
    it("creates a valid pre-authorized code session with default TTL", () => {
      const session = sessionManager.createPreAuthorizedCode({
        studentId: "STU-2026-8899",
        credentialConfigurationId: "graduation_record_sd_jwt_vc",
      });

      expect(session.code).toStartWith("poc_");
      expect(session.studentId).toBe("STU-2026-8899");
      expect(session.credentialConfigurationId).toBe("graduation_record_sd_jwt_vc");
      expect(session.txCode).toBeUndefined();
      expect(session.expiresAt).toBeGreaterThan(session.createdAt);
      expect(session.expiresAt - session.createdAt).toBe(600 * 1000); // 10 minutes default
      expect(sessionManager.preAuthCodeCount).toBe(1);
    });

    it("creates a pre-authorized code with custom TTL and optional txCode PIN", () => {
      const session = sessionManager.createPreAuthorizedCode({
        studentId: "STU-1234",
        credentialConfigurationId: "degree_vc",
        txCode: "9876",
        ttlSeconds: 300,
      });

      expect(session.txCode).toBe("9876");
      expect(session.expiresAt - session.createdAt).toBe(300 * 1000);
    });

    it("rejects empty studentId or credentialConfigurationId", () => {
      expect(() =>
        sessionManager.createPreAuthorizedCode({
          studentId: "",
          credentialConfigurationId: "valid_id",
        })
      ).toThrow("studentId must be a non-empty string");

      expect(() =>
        sessionManager.createPreAuthorizedCode({
          studentId: "valid_student",
          credentialConfigurationId: "   ",
        })
      ).toThrow("credentialConfigurationId must be a non-empty string");
    });
  });

  describe("Atomic Code Exchange & Replay Defense", () => {
    it("successfully exchanges valid pre-authorized code for access token and c_nonce", () => {
      const session = sessionManager.createPreAuthorizedCode({
        studentId: "STU-2026-8899",
        credentialConfigurationId: "graduation_record_sd_jwt_vc",
      });

      const result = sessionManager.exchangePreAuthorizedCode({
        code: session.code,
      });

      expect(result.tokenType).toBe("Bearer");
      expect(result.accessToken).toStartWith("iat_");
      expect(result.cNonce).toStartWith("cnonce_");
      expect(result.expiresIn).toBe(600);
      expect(result.cNonceExpiresIn).toBe(86400);

      // Verify code was burned from pre-auth map
      expect(sessionManager.preAuthCodeCount).toBe(0);
      expect(sessionManager.accessTokenCount).toBe(1);

      // Verify access token session is retrievable
      const accessSession = sessionManager.getAccessTokenSession(result.accessToken);
      expect(accessSession).toBeDefined();
      expect(accessSession?.studentId).toBe("STU-2026-8899");
      expect(accessSession?.cNonce).toBe(result.cNonce);
    });

    it("enforces atomic single-use: replaying the same code fails immediately", () => {
      const session = sessionManager.createPreAuthorizedCode({
        studentId: "STU-2026-8899",
        credentialConfigurationId: "graduation_record_sd_jwt_vc",
      });

      // First exchange succeeds
      const result = sessionManager.exchangePreAuthorizedCode({
        code: session.code,
      });
      expect(result.accessToken).toBeDefined();

      // Second exchange with same code MUST fail with InvalidGrantError
      expect(() =>
        sessionManager.exchangePreAuthorizedCode({
          code: session.code,
        })
      ).toThrow(InvalidGrantError);

      try {
        sessionManager.exchangePreAuthorizedCode({ code: session.code });
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidGrantError);
        expect((err as InvalidGrantError).code).toBe("invalid_grant");
      }
    });

    it("preserves custom claims across pre-authorized code exchange into access token session", () => {
      const customClaims = {
        fullName: "Custom Student",
        papers: { diploma: { degreeName: "Custom Degree" } },
      };
      const session = sessionManager.createPreAuthorizedCode({
        studentId: "STU-CUSTOM",
        credentialConfigurationId: "graduation_record_sd_jwt_vc",
        claims: customClaims,
      });

      expect(session.claims).toEqual(customClaims);

      const { accessToken } = sessionManager.exchangePreAuthorizedCode({
        code: session.code,
      });

      const accessSession = sessionManager.getAccessTokenSession(accessToken);
      expect(accessSession).toBeDefined();
      expect(accessSession?.claims).toEqual(customClaims);
    });

    it("rejects non-existent code", () => {
      expect(() =>
        sessionManager.exchangePreAuthorizedCode({
          code: "poc_non_existent_code_12345",
        })
      ).toThrow(InvalidGrantError);
    });

    it("rejects expired pre-authorized code", () => {
      // Create session with negative TTL (already expired)
      const session = sessionManager.createPreAuthorizedCode({
        studentId: "STU-EXPIRED",
        credentialConfigurationId: "grad_vc",
        ttlSeconds: -10,
      });

      expect(() =>
        sessionManager.exchangePreAuthorizedCode({
          code: session.code,
        })
      ).toThrow("The pre-authorized code has expired");
    });
  });

  describe("Transaction Code (tx_code / PIN) Validation", () => {
    it("successfully exchanges when txCode matches", () => {
      const session = sessionManager.createPreAuthorizedCode({
        studentId: "STU-PIN",
        credentialConfigurationId: "grad_vc",
        txCode: "4321",
      });

      const result = sessionManager.exchangePreAuthorizedCode({
        code: session.code,
        txCode: "4321",
      });

      expect(result.accessToken).toBeDefined();
    });

    it("rejects when txCode is incorrect and immediately burns code to prevent brute forcing", () => {
      const session = sessionManager.createPreAuthorizedCode({
        studentId: "STU-PIN",
        credentialConfigurationId: "grad_vc",
        txCode: "4321",
      });

      // Attempt with wrong PIN
      expect(() =>
        sessionManager.exchangePreAuthorizedCode({
          code: session.code,
          txCode: "9999",
        })
      ).toThrow("Invalid transaction code (PIN)");

      // Verify code was burned even on PIN failure
      expect(sessionManager.preAuthCodeCount).toBe(0);

      // Subsequent attempt with correct PIN fails because code was already burned
      expect(() =>
        sessionManager.exchangePreAuthorizedCode({
          code: session.code,
          txCode: "4321",
        })
      ).toThrow("The pre-authorized code is invalid, expired, or has already been used");
    });

    it("rejects when txCode is omitted but session required one", () => {
      const session = sessionManager.createPreAuthorizedCode({
        studentId: "STU-PIN",
        credentialConfigurationId: "grad_vc",
        txCode: "1234",
      });

      expect(() =>
        sessionManager.exchangePreAuthorizedCode({
          code: session.code,
        })
      ).toThrow("Invalid transaction code (PIN)");
    });
  });

  describe("Access Token & Nonce Rotation Lifecycle", () => {
    it("returns undefined for expired access token", () => {
      const session = sessionManager.createPreAuthorizedCode({
        studentId: "STU-TEST",
        credentialConfigurationId: "grad_vc",
      });

      const { accessToken } = sessionManager.exchangePreAuthorizedCode({
        code: session.code,
        accessTokenTtlSeconds: -5, // already expired
      });

      const retrieved = sessionManager.getAccessTokenSession(accessToken);
      expect(retrieved).toBeUndefined();
    });

    it("validates and rotates c_nonce challenge during issuance interaction", () => {
      const session = sessionManager.createPreAuthorizedCode({
        studentId: "STU-ROTATION",
        credentialConfigurationId: "grad_vc",
      });

      const { accessToken, cNonce } = sessionManager.exchangePreAuthorizedCode({
        code: session.code,
      });

      // 1. Verify matching nonce succeeds and rotates to fresh nonce
      const rotation1 = sessionManager.validateAndRotateNonce(accessToken, cNonce);
      expect(rotation1.valid).toBe(true);
      expect(rotation1.newNonce).toBeDefined();
      expect(rotation1.newNonce).not.toBe(cNonce);

      // 2. Old nonce is no longer valid
      const oldCheck = sessionManager.validateAndRotateNonce(accessToken, cNonce);
      expect(oldCheck.valid).toBe(false);
      expect(oldCheck.error).toBe("mismatched_nonce");

      // 3. New rotated nonce succeeds
      const rotation2 = sessionManager.validateAndRotateNonce(accessToken, rotation1.newNonce!);
      expect(rotation2.valid).toBe(true);
      expect(rotation2.newNonce).toBeDefined();
    });

    it("cleans up expired sessions properly via cleanupExpired", () => {
      sessionManager.createPreAuthorizedCode({
        studentId: "STU-EXP1",
        credentialConfigurationId: "vc",
        ttlSeconds: -10,
      });
      sessionManager.createPreAuthorizedCode({
        studentId: "STU-VALID",
        credentialConfigurationId: "vc",
        ttlSeconds: 600,
      });

      expect(sessionManager.preAuthCodeCount).toBe(2);
      sessionManager.cleanupExpired();
      expect(sessionManager.preAuthCodeCount).toBe(1);
    });
  });
});
