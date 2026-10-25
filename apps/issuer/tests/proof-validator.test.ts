import { describe, expect, it } from "bun:test";
import * as jose from "jose";
import {
  verifyHolderProof,
  InvalidProofError,
  sanitizePublicJwk,
  type HolderProofParameter,
} from "../src/services/proof-validator.js";

describe("Holder Proof-of-Possession Validator (OpenID4VCI 1.0 Final)", () => {
  const issuerBaseUrl = "https://issuer.university.edu";
  const issuerDid = "did:web:issuer.university.edu";
  const cNonce = "cnonce_test_challenge_1234567890abcdef";

  async function createValidProof(options?: {
    alg?: "ES256" | "EdDSA" | "ES384";
    typ?: string;
    aud?: string | string[];
    nonce?: string;
    iat?: number;
    includePrivateD?: boolean;
    tamperSignature?: boolean;
  }): Promise<{ proof: HolderProofParameter; publicJwk: jose.JWK }> {
    const alg = options?.alg ?? "ES256";
    const keyPair = await jose.generateKeyPair(alg, { extractable: true });
    const fullJwk = await jose.exportJWK(keyPair.privateKey);
    const publicJwk = await jose.exportJWK(keyPair.publicKey);

    const headerJwk = options?.includePrivateD ? fullJwk : publicJwk;
    const nowSeconds = Math.floor(Date.now() / 1000);

    const jwt = await new jose.SignJWT({
      aud: options?.aud ?? issuerBaseUrl,
      nonce: options?.nonce ?? cNonce,
      iat: options?.iat ?? nowSeconds,
    })
      .setProtectedHeader({
        alg,
        typ: options?.typ ?? "openid-credential-proof+jwt",
        jwk: headerJwk,
      })
      .sign(keyPair.privateKey);

    const finalJwt = options?.tamperSignature
      ? jwt.slice(0, -6) + "xxxxxx"
      : jwt;

    return {
      proof: {
        proof_type: "jwt",
        jwt: finalJwt,
      },
      publicJwk,
    };
  }

  it("verifies valid proof successfully across ES256, EdDSA, and ES384 algorithms", async () => {
    const algorithms: Array<"ES256" | "EdDSA" | "ES384"> = [
      "ES256",
      "EdDSA",
      "ES384",
    ];

    for (const alg of algorithms) {
      const { proof, publicJwk } = await createValidProof({ alg });
      const result = await verifyHolderProof(proof, issuerBaseUrl, cNonce);

      expect(result.holderJwk.kty).toBe(publicJwk.kty);
      expect(result.holderJwk.crv).toBe(publicJwk.crv);
      expect(result.payload.nonce).toBe(cNonce);
      expect(result.payload.aud).toBe(issuerBaseUrl);
    }
  });

  it("accepts standard proof typ headers and gates legacy typ behind allowLegacyProofTyp", async () => {
    // Standard types accepted by default
    for (const typ of ["openid-credential-proof+jwt", "openid4vci-proof+jwt"]) {
      const { proof } = await createValidProof({ typ });
      const result = await verifyHolderProof(proof, issuerBaseUrl, cNonce);
      expect(result.header.typ).toBe(typ);
    }

    // Legacy "jwt" rejected by default
    const { proof: legacyProof } = await createValidProof({ typ: "jwt" });
    expect(
      verifyHolderProof(legacyProof, issuerBaseUrl, cNonce)
    ).rejects.toThrow("rejected by default policy");

    // Legacy "jwt" accepted when allowLegacyProofTyp is explicitly true
    const resultLegacy = await verifyHolderProof(
      legacyProof,
      issuerBaseUrl,
      cNonce,
      { allowLegacyProofTyp: true }
    );
    expect(resultLegacy.header.typ).toBe("jwt");
  });

  it("verifies proof against array of allowed audiences matching either baseUrl or DID", async () => {
    const { proof } = await createValidProof({ aud: issuerDid });
    const result = await verifyHolderProof(
      proof,
      [issuerBaseUrl, issuerDid],
      cNonce
    );
    expect(result.payload.aud).toBe(issuerDid);
  });

  it("rejects missing or non-object proof parameter with invalid_or_missing_proof error", () => {
    for (const invalid of [null, undefined, "not-an-object", 12345]) {
      expect(
        verifyHolderProof(invalid, issuerBaseUrl, cNonce)
      ).rejects.toThrow(InvalidProofError);
    }
  });

  it("rejects proof with unsupported proof_type parameter", async () => {
    const { proof } = await createValidProof();
    proof.proof_type = "cwt";

    expect(
      verifyHolderProof(proof, issuerBaseUrl, cNonce)
    ).rejects.toThrow("Unsupported proof_type");
  });

  it("rejects malformed JWT string", () => {
    const badProof: HolderProofParameter = {
      proof_type: "jwt",
      jwt: "this.is.not.a.valid.jwt",
    };

    expect(
      verifyHolderProof(badProof, issuerBaseUrl, cNonce)
    ).rejects.toThrow(InvalidProofError);
  });

  it("rejects unsupported signature algorithm in protected header", async () => {
    const key = new TextEncoder().encode("secret-key-too-short");
    const badJwt = await new jose.SignJWT({ aud: issuerBaseUrl, nonce: cNonce, iat: Math.floor(Date.now() / 1000) })
      .setProtectedHeader({ alg: "HS256", typ: "openid4vci-proof+jwt", jwk: { kty: "oct", k: "secret" } as any })
      .sign(key);

    expect(
      verifyHolderProof({ proof_type: "jwt", jwt: badJwt }, issuerBaseUrl, cNonce)
    ).rejects.toThrow("Unsupported proof algorithm");
  });

  it("rejects proof header omitting public jwk object", async () => {
    const keyPair = await jose.generateKeyPair("ES256");
    const jwtWithoutJwk = await new jose.SignJWT({
      aud: issuerBaseUrl,
      nonce: cNonce,
      iat: Math.floor(Date.now() / 1000),
    })
      .setProtectedHeader({
        alg: "ES256",
        typ: "openid-credential-proof+jwt",
      })
      .sign(keyPair.privateKey);

    expect(
      verifyHolderProof(
        { proof_type: "jwt", jwt: jwtWithoutJwk },
        issuerBaseUrl,
        cNonce
      )
    ).rejects.toThrow("must include a valid 'jwk' object");
  });

  it("rejects proof containing private key parameter in header jwk", async () => {
    const { proof } = await createValidProof({ includePrivateD: true });

    expect(
      verifyHolderProof(proof, issuerBaseUrl, cNonce)
    ).rejects.toThrow("must not contain private key property 'd'");
  });

  it("rejects proof with forged or tampered signature", async () => {
    const { proof } = await createValidProof({ tamperSignature: true });

    expect(
      verifyHolderProof(proof, issuerBaseUrl, cNonce)
    ).rejects.toThrow("Proof cryptographic verification failed");
  });

  it("rejects proof with audience mismatch", async () => {
    const { proof } = await createValidProof({ aud: "https://attacker.com" });

    expect(
      verifyHolderProof(proof, issuerBaseUrl, cNonce)
    ).rejects.toThrow("does not match expected issuer audience");
  });

  it("rejects proof with nonce mismatch against session c_nonce", async () => {
    const { proof } = await createValidProof({ nonce: "cnonce_wrong_nonce" });

    expect(
      verifyHolderProof(proof, issuerBaseUrl, cNonce)
    ).rejects.toThrow("does not match session c_nonce challenge");
  });

  it("rejects proof with timestamp outside acceptable clock skew", async () => {
    const expiredTimestamp = Math.floor(Date.now() / 1000) - 400; // 400s ago (>300s)
    const { proof } = await createValidProof({ iat: expiredTimestamp });

    expect(
      verifyHolderProof(proof, issuerBaseUrl, cNonce, 300)
    ).rejects.toThrow("outside acceptable clock skew");
  });

  it("sanitizes public jwk properly by removing any extraneous private properties", () => {
    const jwkWithPrivate = {
      kty: "EC",
      crv: "P-256",
      x: "test-x",
      y: "test-y",
      d: "secret-d",
      p: "secret-p",
    } as any;

    const sanitized = sanitizePublicJwk(jwkWithPrivate);
    expect(sanitized.kty).toBe("EC");
    expect((sanitized as any).d).toBeUndefined();
    expect((sanitized as any).p).toBeUndefined();
  });

  it("verifies proof from modern OpenID4VCI 1.0 Final proofs.jwt array structure", async () => {
    const { proof } = await createValidProof({ typ: "openid4vci-proof+jwt" });
    const requestBody = {
      credential_configuration_id: "graduation_record_sd_jwt_vc",
      proofs: {
        jwt: [proof.jwt],
      },
    };

    const result = await verifyHolderProof(requestBody, issuerBaseUrl, cNonce);
    expect(result.payload.nonce).toBe(cNonce);
    expect(result.header.typ).toBe("openid4vci-proof+jwt");
  });

  it("verifies proof from single proofs.jwt string and gates direct compact JWT string behind allowLegacyShapes", async () => {
    const { proof } = await createValidProof({ typ: "openid4vci-proof+jwt" });

    // proofs: { jwt: "..." } (single string wire shape)
    const resultFromObj = await verifyHolderProof(
      { proofs: { jwt: proof.jwt } },
      issuerBaseUrl,
      cNonce
    );
    expect(resultFromObj.payload.nonce).toBe(cNonce);

    // Direct JWT string rejected by default
    expect(
      verifyHolderProof(proof.jwt, issuerBaseUrl, cNonce)
    ).rejects.toThrow("Missing or malformed proof object");

    // Direct JWT string succeeds with allowLegacyShapes
    const resultFromStr = await verifyHolderProof(
      proof.jwt,
      issuerBaseUrl,
      cNonce,
      { allowLegacyShapes: true }
    );
    expect(resultFromStr.payload.nonce).toBe(cNonce);
  });

  it("strictly rejects request containing both proof and proofs parameters", async () => {
    const { proof: proof1 } = await createValidProof({ typ: "openid4vci-proof+jwt" });
    const { proof: proof2 } = await createValidProof({ typ: "openid-credential-proof+jwt" });

    const conflictedRequest = {
      credential_configuration_id: "graduation_record_sd_jwt_vc",
      proof: proof2,
      proofs: {
        jwt: [proof1.jwt],
      },
    };

    expect(
      verifyHolderProof(conflictedRequest, issuerBaseUrl, cNonce)
    ).rejects.toThrow("Request must not contain both 'proof' and 'proofs' parameters");
  });

  it("verifies proof when audience points to /credential endpoint with trailing slashes", async () => {
    const credAudience = `${issuerBaseUrl}/credential/`;
    const { proof } = await createValidProof({ aud: credAudience });

    const result = await verifyHolderProof(
      proof,
      [issuerBaseUrl, `${issuerBaseUrl}/credential`, issuerDid],
      cNonce
    );
    expect(result.payload.aud).toBe(credAudience);
  });

  it("extracts and verifies holder public key from did:jwk kid parameter", async () => {
    const keyPair = await jose.generateKeyPair("ES256", { extractable: true });
    const publicJwk = await jose.exportJWK(keyPair.publicKey);
    const didJwkString = `did:jwk:${Buffer.from(JSON.stringify(publicJwk)).toString("base64url")}#0`;

    const jwtWithDidJwk = await new jose.SignJWT({
      aud: issuerBaseUrl,
      nonce: cNonce,
      iat: Math.floor(Date.now() / 1000),
    })
      .setProtectedHeader({
        alg: "ES256",
        typ: "openid4vci-proof+jwt",
        kid: didJwkString,
      })
      .sign(keyPair.privateKey);

    const result = await verifyHolderProof(
      { proofs: { jwt: [jwtWithDidJwk] } },
      issuerBaseUrl,
      cNonce
    );
    expect(result.holderJwk.crv).toBe("P-256");
    expect(result.payload.nonce).toBe(cNonce);
  });
});
