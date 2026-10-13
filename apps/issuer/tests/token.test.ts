import { describe, expect, it, beforeEach } from "bun:test";
import { SessionManager } from "../src/services/session-manager.js";
import {
  handleTokenRequest,
  PRE_AUTHORIZED_CODE_GRANT_TYPE,
  MAX_TOKEN_REQUEST_SIZE_BYTES,
  type TokenResponse,
  type TokenErrorResponse,
} from "../src/routes/token.js";

describe("OAuth 2.0 Token Endpoint Hardening (OpenID4VCI 1.0 Final Section 6.2 & RFC 6749)", () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
  });

  describe("Successful Token Exchange", () => {
    it("exchanges valid pre-authorized code via standard application/x-www-form-urlencoded", async () => {
      const session = sessionManager.createPreAuthorizedCode({
        studentId: "STU-FORM-EXCHANGE",
        credentialConfigurationId: "graduation_record_sd_jwt_vc",
      });

      const params = new URLSearchParams();
      params.set("grant_type", PRE_AUTHORIZED_CODE_GRANT_TYPE);
      params.set("pre-authorized_code", session.code);

      const req = new Request("http://localhost:3000/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      const res = await handleTokenRequest(req, sessionManager);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("pragma")).toBe("no-cache");

      const body = (await res.json()) as TokenResponse;
      expect(body.token_type).toBe("Bearer");
      expect(body.access_token).toStartWith("iat_");
      expect(body.expires_in).toBe(600);
      expect(body.c_nonce).toStartWith("cnonce_");
      expect(body.c_nonce_expires_in).toBe(86400);

      // Verify access token session is retrievable
      const accessSession = sessionManager.getAccessTokenSession(body.access_token);
      expect(accessSession).toBeDefined();
      expect(accessSession?.studentId).toBe("STU-FORM-EXCHANGE");
    });

    it("allows application/x-www-form-urlencoded with charset suffix", async () => {
      const session = sessionManager.createPreAuthorizedCode({
        studentId: "STU-CHARSET",
        credentialConfigurationId: "graduation_record_sd_jwt_vc",
      });

      const params = new URLSearchParams();
      params.set("grant_type", PRE_AUTHORIZED_CODE_GRANT_TYPE);
      params.set("pre-authorized_code", session.code);

      const req = new Request("http://localhost:3000/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
        body: params.toString(),
      });

      const res = await handleTokenRequest(req, sessionManager);
      expect(res.status).toBe(200);
    });

    it("exchanges pre-authorized code with valid tx_code (PIN)", async () => {
      const session = sessionManager.createPreAuthorizedCode({
        studentId: "STU-PIN-EXCHANGE",
        credentialConfigurationId: "graduation_record_sd_jwt_vc",
        txCode: "9988",
      });

      const params = new URLSearchParams();
      params.set("grant_type", PRE_AUTHORIZED_CODE_GRANT_TYPE);
      params.set("pre-authorized_code", session.code);
      params.set("tx_code", "9988");

      const req = new Request("http://localhost:3000/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      const res = await handleTokenRequest(req, sessionManager);
      expect(res.status).toBe(200);
      const body = (await res.json()) as TokenResponse;
      expect(body.access_token).toBeDefined();
    });
  });

  describe("Content-Type Enforcement", () => {
    it("rejects multipart/form-data body with 400 invalid_request", async () => {
      const req = new Request("http://localhost:3000/token", {
        method: "POST",
        headers: { "Content-Type": "multipart/form-data; boundary=---boundary123" },
        body: "---boundary123\r\nContent-Disposition: form-data; name=\"grant_type\"\r\n\r\n...",
      });

      const res = await handleTokenRequest(req, sessionManager);
      expect(res.status).toBe(400);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = (await res.json()) as TokenErrorResponse;
      expect(body.error).toBe("invalid_request");
      expect(body.error_description).toContain("Content-Type must be application/x-www-form-urlencoded");
    });

    it("rejects application/json body with 400 invalid_request", async () => {
      const req = new Request("http://localhost:3000/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: PRE_AUTHORIZED_CODE_GRANT_TYPE }),
      });

      const res = await handleTokenRequest(req, sessionManager);
      expect(res.status).toBe(400);
      const body = (await res.json()) as TokenErrorResponse;
      expect(body.error).toBe("invalid_request");
      expect(body.error_description).toContain("Content-Type must be application/x-www-form-urlencoded");
    });

    it("rejects missing Content-Type header with 400 invalid_request", async () => {
      const req = new Request("http://localhost:3000/token", {
        method: "POST",
        body: "grant_type=" + PRE_AUTHORIZED_CODE_GRANT_TYPE,
      });

      const res = await handleTokenRequest(req, sessionManager);
      expect(res.status).toBe(400);
      const body = (await res.json()) as TokenErrorResponse;
      expect(body.error).toBe("invalid_request");
    });
  });

  describe("Body Size Capping (DoS Defense)", () => {
    it("rejects request when Content-Length header exceeds limit", async () => {
      const req = new Request("http://localhost:3000/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": String(MAX_TOKEN_REQUEST_SIZE_BYTES + 100),
        },
        body: "dummy=payload",
      });

      const res = await handleTokenRequest(req, sessionManager);
      expect(res.status).toBe(400);
      const body = (await res.json()) as TokenErrorResponse;
      expect(body.error).toBe("invalid_request");
      expect(body.error_description).toContain("exceeds maximum allowed size");
    });

    it("rejects request when actual body length exceeds limit", async () => {
      const oversizedBody = "a=".repeat(MAX_TOKEN_REQUEST_SIZE_BYTES + 50);

      const req = new Request("http://localhost:3000/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: oversizedBody,
      });

      const res = await handleTokenRequest(req, sessionManager);
      expect(res.status).toBe(400);
      const body = (await res.json()) as TokenErrorResponse;
      expect(body.error).toBe("invalid_request");
      expect(body.error_description).toContain("exceeds maximum allowed size");
    });
  });

  describe("Duplicate Parameter Prohibition (RFC 6749 Section 3.2)", () => {
    it("rejects request with duplicate grant_type parameter", async () => {
      const body = `grant_type=${encodeURIComponent(
        PRE_AUTHORIZED_CODE_GRANT_TYPE
      )}&grant_type=${encodeURIComponent(PRE_AUTHORIZED_CODE_GRANT_TYPE)}&pre-authorized_code=poc_123`;

      const req = new Request("http://localhost:3000/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });

      const res = await handleTokenRequest(req, sessionManager);
      expect(res.status).toBe(400);
      const resBody = (await res.json()) as TokenErrorResponse;
      expect(resBody.error).toBe("invalid_request");
      expect(resBody.error_description).toContain("Duplicate parameter 'grant_type'");
    });

    it("rejects request with duplicate pre-authorized_code parameter", async () => {
      const body = `grant_type=${encodeURIComponent(
        PRE_AUTHORIZED_CODE_GRANT_TYPE
      )}&pre-authorized_code=poc_1&pre-authorized_code=poc_2`;

      const req = new Request("http://localhost:3000/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });

      const res = await handleTokenRequest(req, sessionManager);
      expect(res.status).toBe(400);
      const resBody = (await res.json()) as TokenErrorResponse;
      expect(resBody.error).toBe("invalid_request");
      expect(resBody.error_description).toContain("Duplicate parameter 'pre-authorized_code'");
    });
  });

  describe("Body-Only Extraction (No Query String Leaks)", () => {
    it("rejects request when pre-authorized_code is only provided in query string", async () => {
      const session = sessionManager.createPreAuthorizedCode({
        studentId: "STU-QUERY-LEAK",
        credentialConfigurationId: "graduation_record_sd_jwt_vc",
      });

      // Code passed in URL query string, omitted from body
      const req = new Request(
        `http://localhost:3000/token?pre-authorized_code=${encodeURIComponent(session.code)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `grant_type=${encodeURIComponent(PRE_AUTHORIZED_CODE_GRANT_TYPE)}`,
        }
      );

      const res = await handleTokenRequest(req, sessionManager);
      expect(res.status).toBe(400);
      const body = (await res.json()) as TokenErrorResponse;
      expect(body.error).toBe("invalid_request");
      expect(body.error_description).toContain("Missing required parameter 'pre-authorized_code'");
    });
  });

  describe("Grant Type & Code Validation (RFC 6749 Section 5.2)", () => {
    it("rejects wrong grant_type with 400 unsupported_grant_type", async () => {
      const params = new URLSearchParams();
      params.set("grant_type", "authorization_code");
      params.set("pre-authorized_code", "poc_dummy");

      const req = new Request("http://localhost:3000/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      const res = await handleTokenRequest(req, sessionManager);
      expect(res.status).toBe(400);
      const body = (await res.json()) as TokenErrorResponse;
      expect(body.error).toBe("unsupported_grant_type");
    });

    it("rejects missing grant_type with 400 invalid_request", async () => {
      const params = new URLSearchParams();
      params.set("pre-authorized_code", "poc_dummy");

      const req = new Request("http://localhost:3000/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      const res = await handleTokenRequest(req, sessionManager);
      expect(res.status).toBe(400);
      const body = (await res.json()) as TokenErrorResponse;
      expect(body.error).toBe("invalid_request");
      expect(body.error_description).toContain("grant_type");
    });

    it("rejects missing pre-authorized_code with 400 invalid_request", async () => {
      const params = new URLSearchParams();
      params.set("grant_type", PRE_AUTHORIZED_CODE_GRANT_TYPE);

      const req = new Request("http://localhost:3000/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      const res = await handleTokenRequest(req, sessionManager);
      expect(res.status).toBe(400);
      const body = (await res.json()) as TokenErrorResponse;
      expect(body.error).toBe("invalid_request");
      expect(body.error_description).toContain("pre-authorized_code");
    });

    it("rejects non-existent pre-authorized_code with 400 invalid_grant", async () => {
      const params = new URLSearchParams();
      params.set("grant_type", PRE_AUTHORIZED_CODE_GRANT_TYPE);
      params.set("pre-authorized_code", "poc_unknown_random_code");

      const req = new Request("http://localhost:3000/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      const res = await handleTokenRequest(req, sessionManager);
      expect(res.status).toBe(400);
      const body = (await res.json()) as TokenErrorResponse;
      expect(body.error).toBe("invalid_grant");
    });

    it("rejects wrong tx_code (PIN) with 400 invalid_grant and burns code", async () => {
      const session = sessionManager.createPreAuthorizedCode({
        studentId: "STU-BAD-PIN",
        credentialConfigurationId: "grad_vc",
        txCode: "1111",
      });

      const params = new URLSearchParams();
      params.set("grant_type", PRE_AUTHORIZED_CODE_GRANT_TYPE);
      params.set("pre-authorized_code", session.code);
      params.set("tx_code", "2222"); // Wrong PIN

      const req = new Request("http://localhost:3000/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      const res = await handleTokenRequest(req, sessionManager);
      expect(res.status).toBe(400);
      const body = (await res.json()) as TokenErrorResponse;
      expect(body.error).toBe("invalid_grant");
      expect(body.error_description).toContain("PIN");

      // Verify code was burned even on PIN failure
      params.set("tx_code", "1111");
      const retryReq = new Request("http://localhost:3000/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const retryRes = await handleTokenRequest(retryReq, sessionManager);
      expect(retryRes.status).toBe(400);
    });

    it("rejects expired pre-authorized_code with 400 invalid_grant", async () => {
      const session = sessionManager.createPreAuthorizedCode({
        studentId: "STU-EXPIRED",
        credentialConfigurationId: "grad_vc",
        ttlSeconds: -10,
      });

      const params = new URLSearchParams();
      params.set("grant_type", PRE_AUTHORIZED_CODE_GRANT_TYPE);
      params.set("pre-authorized_code", session.code);

      const req = new Request("http://localhost:3000/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      const res = await handleTokenRequest(req, sessionManager);
      expect(res.status).toBe(400);
      const body = (await res.json()) as TokenErrorResponse;
      expect(body.error).toBe("invalid_grant");
      expect(body.error_description).toContain("expired");
    });
  });

  describe("Replay Defense & Code Single-Use", () => {
    it("rejects replaying a previously exchanged pre-authorized code", async () => {
      const session = sessionManager.createPreAuthorizedCode({
        studentId: "STU-REPLAY",
        credentialConfigurationId: "graduation_record_sd_jwt_vc",
      });

      const params = new URLSearchParams();
      params.set("grant_type", PRE_AUTHORIZED_CODE_GRANT_TYPE);
      params.set("pre-authorized_code", session.code);

      // 1. First exchange succeeds
      const req1 = new Request("http://localhost:3000/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const res1 = await handleTokenRequest(req1, sessionManager);
      expect(res1.status).toBe(200);

      // 2. Second exchange with same code MUST be rejected with 400 invalid_grant
      const req2 = new Request("http://localhost:3000/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const res2 = await handleTokenRequest(req2, sessionManager);
      expect(res2.status).toBe(400);

      const errorBody = (await res2.json()) as TokenErrorResponse;
      expect(errorBody.error).toBe("invalid_grant");
      expect(errorBody.error_description).toContain("already been used");
    });
  });

  describe("Unsupported Methods", () => {
    it("rejects GET request with HTTP 405 Method Not Allowed", async () => {
      const req = new Request("http://localhost:3000/token", { method: "GET" });
      const res = await handleTokenRequest(req, sessionManager);
      expect(res.status).toBe(405);
      const body = (await res.json()) as TokenErrorResponse;
      expect(body.error).toBe("invalid_request");
    });
  });
});
