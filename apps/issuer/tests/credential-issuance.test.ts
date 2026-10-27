import { describe, expect, it, beforeEach } from "bun:test";
import { join } from "node:path";
import * as jose from "jose";
import {
  loadSchemaFromFile,
  decodeDisclosure,
  SD_JWT_VC_TYP,
  resolveVct,
} from "@unidipveri/core";
import { createApp } from "../src/app.js";
import { SessionManager } from "../src/services/session-manager.js";
import { StudentRecordService } from "../src/services/student-records.js";
import {
  StatusListService,
  decompressAndGetBit,
} from "../src/services/status-list.js";
import { initializeKeyManager, type KeyContext } from "../src/services/key-manager.js";
import type { IssuerConfig } from "../src/config.js";

describe("OID4VCI Credential Issuance & Revocation End-to-End Suite", () => {
  const schemaPath = join(
    import.meta.dir,
    "../../../schemas/graduation-record.v1.yaml"
  );

  const mockConfig: IssuerConfig = {
    schemaPath,
    signingAlgorithm: "ES256",
    keyId: "issuer-key-1",
    issuerDid: "did:web:issuer.university.edu",
    baseUrl: "https://issuer.university.edu",
    vctBaseUrl: "https://issuer.university.edu",
    issuerIdentifierMode: "did",
    port: 3000,
    enableLegacyVcFormat: false,
  };

  let sessionManager: SessionManager;
  let studentRecordsService: StudentRecordService;
  let statusListService: StatusListService;
  let keyContext: KeyContext;
  let app: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    const schemaConfig = await loadSchemaFromFile(schemaPath);
    keyContext = await initializeKeyManager(mockConfig);
    sessionManager = new SessionManager();
    studentRecordsService = new StudentRecordService();
    statusListService = new StatusListService();

    app = createApp(
      mockConfig,
      keyContext,
      schemaConfig,
      sessionManager,
      studentRecordsService,
      statusListService
    );
  });

  async function createHolderProof(
    keyPair: jose.GenerateKeyPairResult,
    cNonce: string,
    options?: {
      aud?: string;
      alg?: string;
      typ?: string;
      tamper?: boolean;
    }
  ): Promise<string> {
    const publicJwk = await jose.exportJWK(keyPair.publicKey);
    const alg = options?.alg ?? "ES256";

    const jwt = await new jose.SignJWT({
      aud: options?.aud ?? mockConfig.baseUrl,
      nonce: cNonce,
      iat: Math.floor(Date.now() / 1000),
    })
      .setProtectedHeader({
        alg,
        typ: options?.typ ?? "openid-credential-proof+jwt",
        jwk: publicJwk,
      })
      .sign(keyPair.privateKey);

    if (options?.tamper) {
      return jwt.slice(0, -5) + "abcde";
    }
    return jwt;
  }

  it("completes full lifecycle from credential offer to issuance and status verification", async () => {
    // 1. Create Credential Offer
    const offerRes = await app(
      new Request("https://issuer.university.edu/credential-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: "STU-2026-FINAL",
          credential_configuration_id: "graduation_record_sd_jwt_vc",
        }),
      })
    );
    expect(offerRes.status).toBe(200);
    const offerData = (await offerRes.json()) as any;
    const preAuthCode =
      offerData.credential_offer.grants[
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      ]["pre-authorized_code"];
    expect(preAuthCode).toBeDefined();

    // 2. Token Exchange
    const tokenRes = await app(
      new Request("https://issuer.university.edu/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=${encodeURIComponent(
          preAuthCode
        )}`,
      })
    );
    expect(tokenRes.status).toBe(200);
    const tokenData = (await tokenRes.json()) as any;
    const accessToken = tokenData.access_token;
    const cNonce = tokenData.c_nonce;
    expect(accessToken).toStartWith("iat_");
    expect(cNonce).toStartWith("cnonce_");

    // 3. Holder Proof Generation
    const holderKeyPair = await jose.generateKeyPair("ES256", { extractable: true });
    const proofJwt = await createHolderProof(holderKeyPair, cNonce);

    // 4. Credential Request (POST /credential)
    const credRes = await app(
      new Request("https://issuer.university.edu/credential", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          credential_configuration_id: "graduation_record_sd_jwt_vc",
          proof: {
            proof_type: "jwt",
            jwt: proofJwt,
          },
        }),
      })
    );
    expect(credRes.status).toBe(200);
    const credData = (await credRes.json()) as any;
    expect(credData.credential).toBeDefined();
    expect(credData.c_nonce).toBeDefined();
    expect(credData.c_nonce).not.toBe(cNonce); // Nonce was rotated

    // 5. Verify the Issued SD-JWT VC format and content
    const compactToken = credData.credential as string;
    const parts = compactToken.split("~");
    expect(parts.length).toBeGreaterThan(2);

    const jwtString = parts[0];
    const header = jose.decodeProtectedHeader(jwtString);
    expect(header.typ).toBe(SD_JWT_VC_TYP);
    expect(header.alg).toBe(mockConfig.signingAlgorithm);
    expect(header.kid).toBe(`${mockConfig.issuerDid}#${mockConfig.keyId}`);

    // Verify outer JWS using issuer's public key
    const importedIssuerKey = await jose.importJWK(keyContext.publicKeyJwk, "ES256");
    const { payload } = await jose.jwtVerify(jwtString, importedIssuerKey);

    expect(payload.iss).toBe(mockConfig.issuerDid);
    expect(payload.vct).toBe(resolveVct("/types/graduation-record/v1", mockConfig.vctBaseUrl));

    // Confirm cnf.jwk matches holder key
    const holderPublicJwk = await jose.exportJWK(holderKeyPair.publicKey);
    const cnf = payload.cnf as { jwk: jose.JWK };
    expect(cnf.jwk.kty).toBe(holderPublicJwk.kty);
    expect(cnf.jwk.crv).toBe(holderPublicJwk.crv);
    expect(cnf.jwk.x).toBe(holderPublicJwk.x);

    // Confirm status_list claim
    const statusClaim = payload.status as { status_list: { idx: number; uri: string } };
    expect(typeof statusClaim.status_list.idx).toBe("number");
    expect(statusClaim.status_list.uri).toBe(
      `${mockConfig.baseUrl}/status/status-list-1`
    );

    // Verify initial revocation status is active (0)
    const statusRes = await app(
      new Request(statusClaim.status_list.uri, { method: "GET" })
    );
    expect(statusRes.status).toBe(200);
    const statusJwt = await statusRes.text();
    const { payload: statusPayload } = await jose.jwtVerify(statusJwt, importedIssuerKey);
    const statusObj = statusPayload.status_list as { bits: number; lst: string };
    expect(decompressAndGetBit(statusObj.lst, statusClaim.status_list.idx)).toBe(0);

    // 6. Administrative Revocation
    const revokeRes = await app(
      new Request("https://issuer.university.edu/admin/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idx: statusClaim.status_list.idx }),
      })
    );
    expect(revokeRes.status).toBe(200);

    // Verify updated status list reflects revocation (1)
    const updatedStatusRes = await app(
      new Request(statusClaim.status_list.uri, { method: "GET" })
    );
    const updatedStatusJwt = await updatedStatusRes.text();
    const { payload: updatedPayload } = await jose.jwtVerify(
      updatedStatusJwt,
      importedIssuerKey
    );
    const updatedStatusObj = updatedPayload.status_list as { bits: number; lst: string };
    expect(decompressAndGetBit(updatedStatusObj.lst, statusClaim.status_list.idx)).toBe(1);
  });

  it("embeds custom claims entered at offer generation directly into issued credential disclosures", async () => {
    const customDegree = "Bachelor of Engineering in Artificial Intelligence";
    const customHonours = "Distinction with Highest Honors";
    const customGpa = 3.99;

    const offerRes = await app(
      new Request("https://issuer.university.edu/credential-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: "STU-AI-01",
          credential_configuration_id: "graduation_record_sd_jwt_vc",
          claims: {
            studentId: "STU-AI-01",
            fullName: "Custom AI Student",
            papers: {
              diploma: {
                degreeName: customDegree,
                degreeType: "Bachelor of Engineering",
                programName: "Artificial Intelligence",
                major: "Artificial Intelligence",
                graduationDate: "2026-06-30",
                honours: customHonours,
              },
              transcript: {
                transcriptId: "TR-AI-01",
                cumulativeGPA: customGpa,
                courses: [
                  {
                    code: "AI101",
                    title: "Neural Networks & Deep Learning",
                    credits: 4,
                    grade: 4.0,
                    letterGrade: "A",
                  },
                ],
              },
            },
          },
        }),
      })
    );
    const { credential_offer } = (await offerRes.json()) as any;
    const preAuthCode =
      credential_offer.grants[
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      ]["pre-authorized_code"];

    const tokenRes = await app(
      new Request("https://issuer.university.edu/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=${encodeURIComponent(
          preAuthCode
        )}`,
      })
    );
    const { access_token, c_nonce } = (await tokenRes.json()) as any;

    const holderKeyPair = await jose.generateKeyPair("ES256", { extractable: true });
    const proofJwt = await createHolderProof(holderKeyPair, c_nonce);

    const credRes = await app(
      new Request("https://issuer.university.edu/credential", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          credential_configuration_id: "graduation_record_sd_jwt_vc",
          proof: { proof_type: "jwt", jwt: proofJwt },
        }),
      })
    );
    expect(credRes.status).toBe(200);
    const { credential } = (await credRes.json()) as any;

    // Decode disclosures and check custom claims
    const disclosures = (credential as string)
      .split("~")
      .slice(1, -1)
      .map((d) => decodeDisclosure(d));

    const foundHonours = disclosures.find((d) => d.key === "honours");
    expect(foundHonours).toBeDefined();
    expect(foundHonours?.value).toBe(customHonours);

    const foundGpa = disclosures.find((d) => d.key === "cumulativeGPA");
    expect(foundGpa).toBeDefined();
    expect(foundGpa?.value).toBe(customGpa);

    const foundCourseGrade = disclosures.find((d) => d.key === "grade");
    expect(foundCourseGrade).toBeDefined();
    expect(foundCourseGrade?.value).toBe(4.0);
  });

  it("rejects credential request without Bearer token with HTTP 401", async () => {
    const res = await app(
      new Request("https://issuer.university.edu/credential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("error=\"invalid_token\"");
  });

  it("rejects credential request with expired or non-existent access token with HTTP 401", async () => {
    const res = await app(
      new Request("https://issuer.university.edu/credential", {
        method: "POST",
        headers: {
          Authorization: "Bearer iat_non_existent_token_12345",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(401);
  });

  it("rejects credential request with mismatched credential_configuration_id with HTTP 400", async () => {
    // Obtain valid token for graduation_record_sd_jwt_vc
    const offerRes = await app(
      new Request("https://issuer.university.edu/credential-offer?studentId=STU-2026-FINAL", {
        method: "GET",
      })
    );
    const { credential_offer } = (await offerRes.json()) as any;
    const code =
      credential_offer.grants[
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      ]["pre-authorized_code"];

    const tokenRes = await app(
      new Request("https://issuer.university.edu/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=${encodeURIComponent(
          code
        )}`,
      })
    );
    const { access_token } = (await tokenRes.json()) as any;

    const res = await app(
      new Request("https://issuer.university.edu/credential", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          credential_configuration_id: "unknown_credential_config",
        }),
      })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("unsupported_credential_configuration_id");
  });

  it("rejects credential request with tampered holder proof signature with HTTP 400", async () => {
    const offerRes = await app(
      new Request("https://issuer.university.edu/credential-offer?studentId=STU-2026-FINAL", {
        method: "GET",
      })
    );
    const { credential_offer } = (await offerRes.json()) as any;
    const code =
      credential_offer.grants[
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      ]["pre-authorized_code"];

    const tokenRes = await app(
      new Request("https://issuer.university.edu/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=${encodeURIComponent(
          code
        )}`,
      })
    );
    const { access_token, c_nonce } = (await tokenRes.json()) as any;

    const holderKeyPair = await jose.generateKeyPair("ES256", { extractable: true });
    const forgedProofJwt = await createHolderProof(holderKeyPair, c_nonce, { tamper: true });

    const credRes = await app(
      new Request("https://issuer.university.edu/credential", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          credential_configuration_id: "graduation_record_sd_jwt_vc",
          proof: { proof_type: "jwt", jwt: forgedProofJwt },
        }),
      })
    );
    expect(credRes.status).toBe(400);
    const errBody = (await credRes.json()) as any;
    expect(errBody.error).toBe("invalid_proof");
  });

  it("rejects replaying old c_nonce after rotation with HTTP 400", async () => {
    const offerRes = await app(
      new Request("https://issuer.university.edu/credential-offer?studentId=STU-2026-FINAL", {
        method: "GET",
      })
    );
    const { credential_offer } = (await offerRes.json()) as any;
    const code =
      credential_offer.grants[
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      ]["pre-authorized_code"];

    const tokenRes = await app(
      new Request("https://issuer.university.edu/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=${encodeURIComponent(
          code
        )}`,
      })
    );
    const { access_token, c_nonce } = (await tokenRes.json()) as any;

    // Rotate nonce via POST /nonce so the original token c_nonce is invalidated
    const nonceRes = await app(
      new Request("https://issuer.university.edu/nonce", {
        method: "POST",
        headers: { Authorization: `Bearer ${access_token}` },
      })
    );
    expect(nonceRes.status).toBe(200);

    const holderKeyPair = await jose.generateKeyPair("ES256", { extractable: true });
    // Sign proof using the old (rotated) c_nonce
    const oldNonceProof = await createHolderProof(holderKeyPair, c_nonce);

    // Request replaying old c_nonce fails with invalid_nonce
    const credRes = await app(
      new Request("https://issuer.university.edu/credential", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          credential_configuration_id: "graduation_record_sd_jwt_vc",
          proof: { proof_type: "jwt", jwt: oldNonceProof },
        }),
      })
    );
    expect(credRes.status).toBe(400);
    const errBody = (await credRes.json()) as any;
    expect(errBody.error).toBe("invalid_nonce");
  });

  it("issues credential when wallet submits modern OpenID4VCI 1.0 Final proofs.jwt array", async () => {
    // 1. Offer
    const offerRes = await app(
      new Request("https://issuer.university.edu/credential-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: "STU-2026-FINAL",
          credential_configuration_id: "graduation_record_sd_jwt_vc",
        }),
      })
    );
    const { credential_offer } = (await offerRes.json()) as any;
    const preAuthCode =
      credential_offer.grants[
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      ]["pre-authorized_code"];

    // 2. Token
    const tokenRes = await app(
      new Request("https://issuer.university.edu/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=${encodeURIComponent(
          preAuthCode
        )}`,
      })
    );
    const { access_token, c_nonce } = (await tokenRes.json()) as any;

    // 3. Proof with typ openid4vci-proof+jwt and aud pointing to /credential
    const holderKeyPair = await jose.generateKeyPair("ES256", { extractable: true });
    const proofJwt = await createHolderProof(holderKeyPair, c_nonce, {
      typ: "openid4vci-proof+jwt",
      aud: "https://issuer.university.edu/credential",
    });

    // 4. Request using modern proofs object
    const credRes = await app(
      new Request("https://issuer.university.edu/credential", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          credential_configuration_id: "graduation_record_sd_jwt_vc",
          proofs: {
            jwt: [proofJwt],
          },
        }),
      })
    );

    expect(credRes.status).toBe(200);
    const credData = (await credRes.json()) as any;
    expect(credData.credential).toBeDefined();
    expect(credData.c_nonce).toBeDefined();
  });

  it("serves POST /nonce endpoint returning fresh c_nonce challenge", async () => {
    const nonceRes = await app(
      new Request("https://issuer.university.edu/nonce", {
        method: "POST",
      })
    );
    expect(nonceRes.status).toBe(200);
    const nonceBody = (await nonceRes.json()) as any;
    expect(nonceBody.c_nonce).toStartWith("cnonce_");
    expect(nonceBody.c_nonce_expires_in).toBe(600);

    const badMethodRes = await app(
      new Request("https://issuer.university.edu/nonce", {
        method: "GET",
      })
    );
    expect(badMethodRes.status).toBe(405);
  });

  it("serves POST /nonce with Bearer token and rotates session c_nonce", async () => {
    const offerRes = await app(
      new Request("https://issuer.university.edu/credential-offer?studentId=STU-2026-FINAL", {
        method: "GET",
      })
    );
    const offerData = (await offerRes.json()) as any;
    const preAuthCode =
      offerData.credential_offer.grants[
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      ]["pre-authorized_code"];

    const tokenRes = await app(
      new Request("https://issuer.university.edu/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=${encodeURIComponent(
          preAuthCode
        )}`,
      })
    );
    const { access_token, c_nonce: tokenNonce } = (await tokenRes.json()) as any;

    const nonceRes = await app(
      new Request("https://issuer.university.edu/nonce", {
        method: "POST",
        headers: { Authorization: `Bearer ${access_token}` },
      })
    );
    expect(nonceRes.status).toBe(200);
    const nonceBody = (await nonceRes.json()) as any;
    expect(nonceBody.c_nonce).toStartWith("cnonce_");
    expect(nonceBody.c_nonce).not.toBe(tokenNonce);
  });

  it("accepts proof signed with standalone nonce from POST /nonce", async () => {
    const offerRes = await app(
      new Request("https://issuer.university.edu/credential-offer?studentId=STU-2026-FINAL", {
        method: "GET",
      })
    );
    const offerData = (await offerRes.json()) as any;
    const preAuthCode =
      offerData.credential_offer.grants[
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      ]["pre-authorized_code"];

    const tokenRes = await app(
      new Request("https://issuer.university.edu/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=${encodeURIComponent(
          preAuthCode
        )}`,
      })
    );
    const { access_token } = (await tokenRes.json()) as any;

    // Wallet requests a fresh standalone nonce without Bearer token
    const nonceRes = await app(
      new Request("https://issuer.university.edu/nonce", {
        method: "POST",
      })
    );
    const { c_nonce: standaloneNonce } = (await nonceRes.json()) as any;

    // Wallet signs proof using standalone nonce
    const holderKeyPair = await jose.generateKeyPair("ES256", { extractable: true });
    const proofJwt = await createHolderProof(holderKeyPair, standaloneNonce, {
      typ: "openid4vci-proof+jwt",
      aud: "https://issuer.university.edu",
    });

    const credRes = await app(
      new Request("https://issuer.university.edu/credential", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          credential_configuration_id: "graduation_record_sd_jwt_vc",
          proofs: {
            jwt: [proofJwt],
          },
        }),
      })
    );

    expect(credRes.status).toBe(200);
    const credData = (await credRes.json()) as any;
    expect(credData.credential).toBeDefined();

    // Verify _sd_alg: "sha-256" is present in the issued SD-JWT payload
    const outerJwt = credData.credential.split("~")[0];
    const decodedPayload = jose.decodeJwt(outerJwt) as any;
    expect(decodedPayload._sd_alg).toBe("sha-256");
  });

  it("rejects legacy vc+sd-jwt format by default when enableLegacyVcFormat is false", async () => {
    const offerRes = await app(
      new Request("https://issuer.university.edu/credential-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: "STU-2026-FINAL",
          credential_configuration_id: "graduation_record_sd_jwt_vc_legacy",
        }),
      })
    );
    expect(offerRes.status).toBe(400);
    const offerErr = (await offerRes.json()) as any;
    expect(offerErr.error).toBe("invalid_request");
    expect(offerErr.error_description).toContain("Unsupported credential_configuration_id");
  });

  it("issues SD-JWT VC with typ vc+sd-jwt when enableLegacyVcFormat is true", async () => {
    const legacyApp = createApp(
      { ...mockConfig, enableLegacyVcFormat: true },
      keyContext,
      await loadSchemaFromFile(schemaPath),
      sessionManager,
      studentRecordsService,
      statusListService
    );

    const offerRes = await legacyApp(
      new Request("https://issuer.university.edu/credential-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: "STU-2026-FINAL",
          credential_configuration_id: "graduation_record_sd_jwt_vc_legacy",
        }),
      })
    );
    const offerData = (await offerRes.json()) as any;
    const preAuthCode =
      offerData.credential_offer.grants[
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      ]["pre-authorized_code"];

    const tokenRes = await legacyApp(
      new Request("https://issuer.university.edu/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=${encodeURIComponent(
          preAuthCode
        )}`,
      })
    );
    const { access_token, c_nonce } = (await tokenRes.json()) as any;

    const holderKeyPair = await jose.generateKeyPair("ES256", { extractable: true });
    const proofJwt = await createHolderProof(holderKeyPair, c_nonce, {
      typ: "openid4vci-proof+jwt",
    });

    const credRes = await legacyApp(
      new Request("https://issuer.university.edu/credential", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          format: "vc+sd-jwt",
          proofs: {
            jwt: [proofJwt],
          },
        }),
      })
    );

    expect(credRes.status).toBe(200);
    const credData = (await credRes.json()) as any;
    const outerJwt = credData.credential.split("~")[0];
    const header = jose.decodeProtectedHeader(outerJwt);
    expect(header.typ).toBe("vc+sd-jwt");
  });

  it("signs Status List Token with issuerDid allowing verification via did.json", async () => {
    const statusRes = await app(
      new Request("https://issuer.university.edu/status/status-list-1", {
        method: "GET",
      })
    );
    expect(statusRes.status).toBe(200);
    const token = await statusRes.text();
    const header = jose.decodeProtectedHeader(token);
    const payload = jose.decodeJwt(token);

    expect(payload.iss).toBe(mockConfig.issuerDid);
    expect(header.kid).toBe(`${mockConfig.issuerDid}#${mockConfig.keyId}`);
  });

  describe("Variant B: HTTPS Issuer Identifier & /.well-known/jwt-vc-issuer", () => {
    it("issues SD-JWT VC with HTTPS iss, kid matching jwt-vc-issuer, and explicit _sd_alg", async () => {
      const httpsConfig: IssuerConfig = {
        ...mockConfig,
        issuerIdentifierMode: "https",
      };

      const httpsApp = createApp(
        httpsConfig,
        keyContext,
        await loadSchemaFromFile(schemaPath),
        new SessionManager(),
        new StudentRecordService(),
        new StatusListService()
      );

      // 1. Get offer
      const offerRes = await httpsApp(
        new Request("https://issuer.university.edu/credential-offer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: "STU-2026-FINAL",
            credential_configuration_id: "graduation_record_sd_jwt_vc",
          }),
        })
      );
      const offerData = (await offerRes.json()) as any;
      const preAuthCode =
        offerData.credential_offer.grants[
          "urn:ietf:params:oauth:grant-type:pre-authorized_code"
        ]["pre-authorized_code"];

      // 2. Token exchange
      const tokenRes = await httpsApp(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=${encodeURIComponent(
            preAuthCode
          )}`,
        })
      );
      const tokenData = (await tokenRes.json()) as any;

      // 3. Proof
      const holderKeyPair = await jose.generateKeyPair("ES256", { extractable: true });
      const proofJwt = await createHolderProof(holderKeyPair, tokenData.c_nonce);

      // 4. Request credential
      const credRes = await httpsApp(
        new Request("https://issuer.university.edu/credential", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            credential_configuration_id: "graduation_record_sd_jwt_vc",
            proof: {
              proof_type: "jwt",
              jwt: proofJwt,
            },
          }),
        })
      );
      expect(credRes.status).toBe(200);
      const credData = (await credRes.json()) as any;

      const compactToken = credData.credential as string;
      const jwtString = compactToken.split("~")[0];
      const header = jose.decodeProtectedHeader(jwtString);
      const payload = jose.decodeJwt(jwtString);

      // Emits HTTPS iss and simple kid
      expect(payload.iss).toBe(httpsConfig.baseUrl);
      expect(header.kid).toBe(httpsConfig.keyId);
      expect(payload._sd_alg).toBe("sha-256");

      // Dereference key from /.well-known/jwt-vc-issuer
      const metadataRes = await httpsApp(
        new Request("https://issuer.university.edu/.well-known/jwt-vc-issuer", {
          method: "GET",
        })
      );
      expect(metadataRes.status).toBe(200);
      const metadata = (await metadataRes.json()) as any;
      expect(metadata.issuer).toBe(httpsConfig.baseUrl);

      const matchedKeyJwk = metadata.jwks.keys.find((k: any) => k.kid === header.kid);
      expect(matchedKeyJwk).toBeDefined();

      const importedKey = await jose.importJWK(matchedKeyJwk, "ES256");
      const verified = await jose.jwtVerify(jwtString, importedKey);
      expect(verified.payload.iss).toBe(httpsConfig.baseUrl);
    });

    it("signs Status List Token with HTTPS iss and kid matching jwt-vc-issuer", async () => {
      const httpsConfig: IssuerConfig = {
        ...mockConfig,
        issuerIdentifierMode: "https",
      };

      const httpsApp = createApp(
        httpsConfig,
        keyContext,
        await loadSchemaFromFile(schemaPath),
        sessionManager,
        studentRecordsService,
        statusListService
      );

      const statusRes = await httpsApp(
        new Request("https://issuer.university.edu/status/status-list-1", {
          method: "GET",
        })
      );
      expect(statusRes.status).toBe(200);
      const token = await statusRes.text();
      const header = jose.decodeProtectedHeader(token);
      const payload = jose.decodeJwt(token);

      expect(payload.iss).toBe(httpsConfig.baseUrl);
      expect(payload.sub).toBe(`${httpsConfig.baseUrl}/status/status-list-1`);
      expect(header.kid).toBe(httpsConfig.keyId);
      expect(typeof payload.iat).toBe("number");
      expect(typeof payload.exp).toBe("number");
      expect(payload.exp).toBeGreaterThan(payload.iat as number);

      // Verifies against jwt-vc-issuer JWKS
      const metadataRes = await httpsApp(
        new Request("https://issuer.university.edu/.well-known/jwt-vc-issuer", {
          method: "GET",
        })
      );
      const metadata = (await metadataRes.json()) as any;
      const matchedKeyJwk = metadata.jwks.keys.find((k: any) => k.kid === header.kid);
      const importedKey = await jose.importJWK(matchedKeyJwk, "ES256");

      const verified = await jose.jwtVerify(token, importedKey);
      expect(verified.payload.iss).toBe(httpsConfig.baseUrl);
    });
  });

  describe("OpenID4VCI 1.0 Final Wire Compatibility & Dual-Format Validation", () => {
    it("completes issuance for OpenID4VCI 1.0 Final shaped request with nonce from /nonce and dual credential response", async () => {
      // 1. Offer
      const offerRes = await app(
        new Request("https://issuer.university.edu/credential-offer?studentId=STU-2026-FINAL", {
          method: "GET",
        })
      );
      const offerData = (await offerRes.json()) as any;
      const preAuthCode =
        offerData.credential_offer.grants[
          "urn:ietf:params:oauth:grant-type:pre-authorized_code"
        ]["pre-authorized_code"];

      // 2. Token exchange
      const tokenRes = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=${encodeURIComponent(
            preAuthCode
          )}`,
        })
      );
      expect(tokenRes.status).toBe(200);
      const { access_token } = (await tokenRes.json()) as any;

      // 3. Obtain fresh nonce from POST /nonce
      const nonceRes = await app(
        new Request("https://issuer.university.edu/nonce", {
          method: "POST",
          headers: { Authorization: `Bearer ${access_token}` },
        })
      );
      expect(nonceRes.status).toBe(200);
      const { c_nonce: freshNonce, c_nonce_expires_in: nonceTtl } = (await nonceRes.json()) as any;
      expect(freshNonce).toStartWith("cnonce_");
      expect(nonceTtl).toBe(600);

      // 4. Generate holder proof with openid4vci-proof+jwt and nonce from /nonce
      const holderKeyPair = await jose.generateKeyPair("ES256", { extractable: true });
      const proofJwt = await createHolderProof(holderKeyPair, freshNonce, {
        typ: "openid4vci-proof+jwt",
        aud: "https://issuer.university.edu",
      });

      // 5. Submit 1.0 Final credential request: proofs.jwt array
      const credRes = await app(
        new Request("https://issuer.university.edu/credential", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            credential_configuration_id: "graduation_record_sd_jwt_vc",
            proofs: {
              jwt: [proofJwt],
            },
          }),
        })
      );

      expect(credRes.status).toBe(200);
      const credBody = (await credRes.json()) as any;

      // Verify dual-wire compatibility: both top-level credential and credentials array
      expect(typeof credBody.credential).toBe("string");
      expect(Array.isArray(credBody.credentials)).toBe(true);
      expect(credBody.credentials.length).toBe(1);
      expect(credBody.credentials[0].credential).toBe(credBody.credential);
      expect(credBody.c_nonce).toStartWith("cnonce_");
      expect(credBody.c_nonce_expires_in).toBe(600);
    });

    it("completes issuance for legacy Draft 11-13 shaped request with proof object and token nonce", async () => {
      // 1. Offer
      const offerRes = await app(
        new Request("https://issuer.university.edu/credential-offer?studentId=STU-2026-FINAL", {
          method: "GET",
        })
      );
      const offerData = (await offerRes.json()) as any;
      const preAuthCode =
        offerData.credential_offer.grants[
          "urn:ietf:params:oauth:grant-type:pre-authorized_code"
        ]["pre-authorized_code"];

      // 2. Token exchange returns initial c_nonce
      const tokenRes = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=${encodeURIComponent(
            preAuthCode
          )}`,
        })
      );
      const { access_token, c_nonce: tokenNonce } = (await tokenRes.json()) as any;

      // 3. Generate holder proof with openid-credential-proof+jwt and token nonce
      const holderKeyPair = await jose.generateKeyPair("ES256", { extractable: true });
      const proofJwt = await createHolderProof(holderKeyPair, tokenNonce, {
        typ: "openid-credential-proof+jwt",
        aud: "https://issuer.university.edu",
      });

      // 4. Submit Draft 11-13 credential request: proof: { proof_type: "jwt", jwt: "..." }
      const credRes = await app(
        new Request("https://issuer.university.edu/credential", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            credential_configuration_id: "graduation_record_sd_jwt_vc",
            proof: {
              proof_type: "jwt",
              jwt: proofJwt,
            },
          }),
        })
      );

      expect(credRes.status).toBe(200);
      const credBody = (await credRes.json()) as any;
      expect(typeof credBody.credential).toBe("string");
      expect(credBody.credentials[0].credential).toBe(credBody.credential);
    });

    it("rejects credential request with multiple proofs in proofs.jwt with invalid_proof", async () => {
      const offerRes = await app(
        new Request("https://issuer.university.edu/credential-offer?studentId=STU-2026-FINAL", {
          method: "GET",
        })
      );
      const { credential_offer } = (await offerRes.json()) as any;
      const code =
        credential_offer.grants[
          "urn:ietf:params:oauth:grant-type:pre-authorized_code"
        ]["pre-authorized_code"];

      const tokenRes = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=${encodeURIComponent(
            code
          )}`,
        })
      );
      const { access_token, c_nonce } = (await tokenRes.json()) as any;

      const kp1 = await jose.generateKeyPair("ES256", { extractable: true });
      const kp2 = await jose.generateKeyPair("ES256", { extractable: true });
      const proof1 = await createHolderProof(kp1, c_nonce);
      const proof2 = await createHolderProof(kp2, c_nonce);

      // Submit request with 2 proofs in proofs.jwt
      const credRes = await app(
        new Request("https://issuer.university.edu/credential", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            credential_configuration_id: "graduation_record_sd_jwt_vc",
            proofs: {
              jwt: [proof1, proof2],
            },
          }),
        })
      );

      expect(credRes.status).toBe(400);
      const errBody = (await credRes.json()) as any;
      expect(errBody.error).toBe("invalid_proof");
      expect(errBody.error_description).toContain("Multiple proofs in proofs.jwt are unsupported");
    });

    it("rejects invalid nonce with invalid_nonce and returns fresh c_nonce challenge", async () => {
      const offerRes = await app(
        new Request("https://issuer.university.edu/credential-offer?studentId=STU-2026-FINAL", {
          method: "GET",
        })
      );
      const { credential_offer } = (await offerRes.json()) as any;
      const code =
        credential_offer.grants[
          "urn:ietf:params:oauth:grant-type:pre-authorized_code"
        ]["pre-authorized_code"];

      const tokenRes = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=${encodeURIComponent(
            code
          )}`,
        })
      );
      const { access_token } = (await tokenRes.json()) as any;

      // Create proof with stale/wrong nonce
      const kp = await jose.generateKeyPair("ES256", { extractable: true });
      const proofWithWrongNonce = await createHolderProof(kp, "cnonce_wrong_stale_123");

      const credRes = await app(
        new Request("https://issuer.university.edu/credential", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            credential_configuration_id: "graduation_record_sd_jwt_vc",
            proofs: {
              jwt: [proofWithWrongNonce],
            },
          }),
        })
      );

      expect(credRes.status).toBe(400);
      const errBody = (await credRes.json()) as any;
      expect(errBody.error).toBe("invalid_nonce");
      expect(errBody.c_nonce).toStartWith("cnonce_");
      expect(errBody.c_nonce_expires_in).toBe(600);
    });

    it("enforces one-shot issuance per session: second POST /credential with same access token fails with 401", async () => {
      const offerRes = await app(
        new Request("https://issuer.university.edu/credential-offer?studentId=STU-2026-FINAL", {
          method: "GET",
        })
      );
      const { credential_offer } = (await offerRes.json()) as any;
      const code =
        credential_offer.grants[
          "urn:ietf:params:oauth:grant-type:pre-authorized_code"
        ]["pre-authorized_code"];

      const tokenRes = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=${encodeURIComponent(
            code
          )}`,
        })
      );
      const { access_token, c_nonce } = (await tokenRes.json()) as any;

      const kp = await jose.generateKeyPair("ES256", { extractable: true });
      const proof = await createHolderProof(kp, c_nonce, {
        typ: "openid4vci-proof+jwt",
      });

      // 1. First issuance succeeds
      const firstCredRes = await app(
        new Request("https://issuer.university.edu/credential", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            credential_configuration_id: "graduation_record_sd_jwt_vc",
            proofs: {
              jwt: [proof],
            },
          }),
        })
      );
      expect(firstCredRes.status).toBe(200);

      // 2. Second issuance with identical access token fails (consumed session)
      const secondCredRes = await app(
        new Request("https://issuer.university.edu/credential", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            credential_configuration_id: "graduation_record_sd_jwt_vc",
            proofs: {
              jwt: [proof],
            },
          }),
        })
      );
      expect(secondCredRes.status).toBe(401);
      const errBody = (await secondCredRes.json()) as any;
      expect(errBody.error).toBe("invalid_token");
    });

    it("rejects request containing both proof and proofs parameters", async () => {
      const offerRes = await app(
        new Request("https://issuer.university.edu/credential-offer?studentId=STU-2026-FINAL", {
          method: "GET",
        })
      );
      const { credential_offer } = (await offerRes.json()) as any;
      const code =
        credential_offer.grants[
          "urn:ietf:params:oauth:grant-type:pre-authorized_code"
        ]["pre-authorized_code"];

      const tokenRes = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=${encodeURIComponent(
            code
          )}`,
        })
      );
      const { access_token, c_nonce } = (await tokenRes.json()) as any;

      const kp = await jose.generateKeyPair("ES256", { extractable: true });
      const proof = await createHolderProof(kp, c_nonce);

      const credRes = await app(
        new Request("https://issuer.university.edu/credential", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            credential_configuration_id: "graduation_record_sd_jwt_vc",
            proof: { proof_type: "jwt", jwt: proof },
            proofs: { jwt: [proof] },
          }),
        })
      );

      expect(credRes.status).toBe(400);
      const errBody = (await credRes.json()) as any;
      expect(errBody.error).toBe("invalid_request");
      expect(errBody.error_description).toContain("must not contain both 'proof' and 'proofs'");
    });

    it("requires format and vct to match session configuration when credential_configuration_id is omitted", async () => {
      const offerRes = await app(
        new Request("https://issuer.university.edu/credential-offer?studentId=STU-2026-FINAL", {
          method: "GET",
        })
      );
      const { credential_offer } = (await offerRes.json()) as any;
      const code =
        credential_offer.grants[
          "urn:ietf:params:oauth:grant-type:pre-authorized_code"
        ]["pre-authorized_code"];

      const tokenRes = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=${encodeURIComponent(
            code
          )}`,
        })
      );
      const { access_token, c_nonce } = (await tokenRes.json()) as any;

      const kp = await jose.generateKeyPair("ES256", { extractable: true });
      const proof = await createHolderProof(kp, c_nonce);

      // Format mismatch: session is dc+sd-jwt, request specifies mso_mdoc
      const mismatchRes = await app(
        new Request("https://issuer.university.edu/credential", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            format: "mso_mdoc",
            proofs: { jwt: [proof] },
          }),
        })
      );
      expect(mismatchRes.status).toBe(400);
      const mismatchBody = (await mismatchRes.json()) as any;
      expect(mismatchBody.error).toBe("unsupported_credential_format");

      // VCT mismatch
      const vctMismatchRes = await app(
        new Request("https://issuer.university.edu/credential", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            format: "dc+sd-jwt",
            vct: "https://issuer.university.edu/types/unknown-credential/v9",
            proofs: { jwt: [proof] },
          }),
        })
      );
      expect(vctMismatchRes.status).toBe(400);
      const vctBody = (await vctMismatchRes.json()) as any;
      expect(vctBody.error).toBe("unsupported_credential_configuration_id");

      // Matching format & vct succeeds and consumes session
      const validFallbackRes = await app(
        new Request("https://issuer.university.edu/credential", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            format: "dc+sd-jwt",
            vct: "https://issuer.university.edu/types/graduation-record/v1",
            proofs: { jwt: [proof] },
          }),
        })
      );
      expect(validFallbackRes.status).toBe(200);
    });

    it("allows issuance when using fresh standalone nonce from no-bearer POST /nonce after session nonce expired", async () => {
      // 1. Offer + Token
      const offerRes = await app(
        new Request("https://issuer.university.edu/credential-offer?studentId=STU-INDEP-NONCE", {
          method: "GET",
        })
      );
      const offerData = (await offerRes.json()) as any;
      const preAuthCode =
        offerData.credential_offer.grants[
          "urn:ietf:params:oauth:grant-type:pre-authorized_code"
        ]["pre-authorized_code"];

      const tokenRes = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=${encodeURIComponent(
            preAuthCode
          )}`,
        })
      );
      expect(tokenRes.status).toBe(200);
      const { access_token } = (await tokenRes.json()) as any;

      // Manually expire the session's internal cNonce
      const session = sessionManager.getAccessTokenSession(access_token)!;
      session.cNonceExpiresAt = Date.now() - 1000;

      // 2. Fetch fresh standalone nonce from unauthenticated (no-bearer) POST /nonce
      const nonceRes = await app(
        new Request("https://issuer.university.edu/nonce", {
          method: "POST",
        })
      );
      expect(nonceRes.status).toBe(200);
      const { c_nonce: standaloneNonce } = (await nonceRes.json()) as any;

      // 3. Holder builds proof using the fresh standalone nonce
      const holderKeyPair = await jose.generateKeyPair("ES256", { extractable: true });
      const proof = await createHolderProof(holderKeyPair, standaloneNonce, {
        typ: "openid4vci-proof+jwt",
        aud: "https://issuer.university.edu",
      });

      // 4. Credential request succeeds because standalone nonce is validated independently of session nonce expiry
      const credRes = await app(
        new Request("https://issuer.university.edu/credential", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            credential_configuration_id: "graduation_record_sd_jwt_vc",
            proofs: { jwt: [proof] },
          }),
        })
      );

      expect(credRes.status).toBe(200);
      const credData = (await credRes.json()) as any;
      expect(credData.credential).toBeDefined();
    });

    it("handles two concurrent POST /credential requests by issuing exactly one credential and allocating one status index", async () => {
      // 1. Offer + Token
      const offerRes = await app(
        new Request("https://issuer.university.edu/credential-offer?studentId=STU-RACE-TEST", {
          method: "GET",
        })
      );
      const offerData = (await offerRes.json()) as any;
      const preAuthCode =
        offerData.credential_offer.grants[
          "urn:ietf:params:oauth:grant-type:pre-authorized_code"
        ]["pre-authorized_code"];

      const tokenRes = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=${encodeURIComponent(
            preAuthCode
          )}`,
        })
      );
      const { access_token } = (await tokenRes.json()) as any;

      // 2. Fetch two valid standalone nonces
      const nonceRes1 = await app(
        new Request("https://issuer.university.edu/nonce", {
          method: "POST",
        })
      );
      const { c_nonce: nonce1 } = (await nonceRes1.json()) as any;

      const nonceRes2 = await app(
        new Request("https://issuer.university.edu/nonce", {
          method: "POST",
        })
      );
      const { c_nonce: nonce2 } = (await nonceRes2.json()) as any;

      // 3. Create two proofs with the two valid nonces
      const holderKeyPair = await jose.generateKeyPair("ES256", { extractable: true });
      const proof1 = await createHolderProof(holderKeyPair, nonce1, {
        typ: "openid4vci-proof+jwt",
        aud: "https://issuer.university.edu",
      });
      const proof2 = await createHolderProof(holderKeyPair, nonce2, {
        typ: "openid4vci-proof+jwt",
        aud: "https://issuer.university.edu",
      });

      const initialStatusIndex = statusListService.allocatedCount;

      // 4. Fire two concurrent POST /credential requests simultaneously
      const req1 = new Request("https://issuer.university.edu/credential", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          credential_configuration_id: "graduation_record_sd_jwt_vc",
          proofs: { jwt: [proof1] },
        }),
      });

      const req2 = new Request("https://issuer.university.edu/credential", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          credential_configuration_id: "graduation_record_sd_jwt_vc",
          proofs: { jwt: [proof2] },
        }),
      });

      const [res1, res2] = await Promise.all([app(req1), app(req2)]);

      const statuses = [res1.status, res2.status].sort();
      // Exactly one succeeds (200), and one fails with 401 Unauthorized (invalid_token)
      expect(statuses).toEqual([200, 401]);

      // Exactly one status index was allocated
      expect(statusListService.allocatedCount).toBe(initialStatusIndex + 1);
    });
  });
});
