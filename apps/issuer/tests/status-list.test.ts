import { describe, expect, it } from "bun:test";
import * as jose from "jose";
import {
  StatusListService,
  STATUS_LIST_TOKEN_TYP,
  decompressAndGetBit,
} from "../src/services/status-list.js";
import { initializeKeyManager } from "../src/services/key-manager.js";
import type { IssuerConfig } from "../src/config.js";

describe("Token Status List Revocation Engine (draft-ietf-oauth-status-list-21)", () => {
  const mockConfig: IssuerConfig = {
    schemaPath: "/path/to/schema.yaml",
    signingAlgorithm: "ES256",
    keyId: "status-key-1",
    issuerDid: "did:web:issuer.university.edu",
    baseUrl: "https://issuer.university.edu",
    vctBaseUrl: "https://issuer.university.edu",
    port: 3000,
  };

  it("allocates sequential indices starting from 0", () => {
    const service = new StatusListService(64);
    expect(service.allocateIndex()).toBe(0);
    expect(service.allocateIndex()).toBe(1);
    expect(service.allocateIndex()).toBe(2);
    expect(service.allocatedCount).toBe(3);
  });

  it("initializes all credential statuses to active (bit value 0)", () => {
    const service = new StatusListService(64);
    const idx0 = service.allocateIndex();
    const idx1 = service.allocateIndex();

    expect(service.getStatus(idx0)).toBe(0);
    expect(service.isRevoked(idx0)).toBe(false);
    expect(service.getStatus(idx1)).toBe(0);
    expect(service.isRevoked(idx1)).toBe(false);
  });

  it("toggles status to revoked (bit value 1) when revoked", () => {
    const service = new StatusListService(64);
    const idx = service.allocateIndex();

    expect(service.isRevoked(idx)).toBe(false);
    service.revoke(idx);
    expect(service.getStatus(idx)).toBe(1);
    expect(service.isRevoked(idx)).toBe(true);
  });

  it("reactivates a previously revoked credential back to 0", () => {
    const service = new StatusListService(64);
    const idx = service.allocateIndex();

    service.revoke(idx);
    expect(service.isRevoked(idx)).toBe(true);

    service.reactivate(idx);
    expect(service.getStatus(idx)).toBe(0);
    expect(service.isRevoked(idx)).toBe(false);
  });

  it("correctly sets and reads bits across byte boundaries (LSB right-to-left)", () => {
    const service = new StatusListService(1024);
    // Boundary indices: bit 0, bit 7 (end of byte 0), bit 8 (start of byte 1), bit 15, bit 255
    const testIndices = [0, 7, 8, 15, 255, 512, 1023];

    for (const idx of testIndices) {
      service.revoke(idx);
    }

    const lst = service.getLst();
    expect(typeof lst).toBe("string");
    expect(lst.length).toBeGreaterThan(0);

    for (let i = 0; i < 1024; i++) {
      const bit = decompressAndGetBit(lst, i);
      if (testIndices.includes(i)) {
        expect(bit).toBe(1);
      } else {
        expect(bit).toBe(0);
      }
    }
  });

  it("rejects out-of-bounds indices with clear error messages", () => {
    const service = new StatusListService(16);

    expect(() => service.getStatus(-1)).toThrow("must be an integer between 0 and 15");
    expect(() => service.getStatus(16)).toThrow("must be an integer between 0 and 15");
    expect(() => service.revoke(16)).toThrow("must be an integer between 0 and 15");
    expect(() => service.reactivate(16)).toThrow("must be an integer between 0 and 15");
  });

  it("throws error when allocation exceeds total status list capacity", () => {
    const service = new StatusListService(8);
    for (let i = 0; i < 8; i++) {
      expect(service.allocateIndex()).toBe(i);
    }

    expect(() => service.allocateIndex()).toThrow("capacity of 8 entries has been exhausted");
  });

  it("generates signed Status List Token JWT verifiable by public key", async () => {
    const keyContext = await initializeKeyManager(mockConfig);

    const service = new StatusListService(128);
    const idx5 = 5;
    const idx42 = 42;
    service.revoke(idx5);
    service.revoke(idx42);

    const token = await service.generateStatusListToken({
      issuer: mockConfig.baseUrl,
      statusListUri: `${mockConfig.baseUrl}/status/status-list-1`,
      keyContext,
      ttlSeconds: 600,
    });

    expect(typeof token).toBe("string");

    // Verify protected header
    const decodedHeader = jose.decodeProtectedHeader(token);
    expect(decodedHeader.typ).toBe(STATUS_LIST_TOKEN_TYP);
    expect(decodedHeader.alg).toBe("ES256");
    expect(decodedHeader.kid).toBe(mockConfig.keyId);

    // Verify JWS signature using issuer public JWK
    const importedPublicKey = await jose.importJWK(keyContext.publicKeyJwk, "ES256");
    const { payload } = await jose.jwtVerify(token, importedPublicKey);

    expect(payload.iss).toBe(mockConfig.baseUrl);
    expect(payload.sub).toBe(`${mockConfig.baseUrl}/status/status-list-1`);
    expect(payload.ttl).toBe(600);
    expect(payload.exp).toBeDefined();

    const statusListObj = payload.status_list as { bits: number; lst: string };
    expect(statusListObj.bits).toBe(1);
    expect(typeof statusListObj.lst).toBe("string");

    // Validate bit values in extracted lst
    expect(decompressAndGetBit(statusListObj.lst, idx5)).toBe(1);
    expect(decompressAndGetBit(statusListObj.lst, idx42)).toBe(1);
    expect(decompressAndGetBit(statusListObj.lst, 0)).toBe(0);
    expect(decompressAndGetBit(statusListObj.lst, 1)).toBe(0);
  });

  it("supports signing status list tokens across EdDSA and ES384 algorithms", async () => {
    const algorithms: Array<"EdDSA" | "ES384"> = ["EdDSA", "ES384"];

    for (const alg of algorithms) {
      const config: IssuerConfig = {
        ...mockConfig,
        signingAlgorithm: alg,
        keyId: `key-${alg}`,
      };

      const keyContext = await initializeKeyManager(config);

      const service = new StatusListService(64);
      service.revoke(10);

      const token = await service.generateStatusListToken({
        issuer: config.baseUrl,
        statusListUri: `${config.baseUrl}/status/status-list-1`,
        keyContext,
      });

      const importedKey = await jose.importJWK(keyContext.publicKeyJwk, alg);
      const { payload } = await jose.jwtVerify(token, importedKey);

      expect(payload.iss).toBe(config.baseUrl);
      const statusListObj = payload.status_list as { bits: number; lst: string };
      expect(decompressAndGetBit(statusListObj.lst, 10)).toBe(1);
      expect(decompressAndGetBit(statusListObj.lst, 9)).toBe(0);
    }
  });
});
