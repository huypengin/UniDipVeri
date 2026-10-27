import { describe, expect, it } from "bun:test";
import * as jose from "jose";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fs from "node:fs";
import {
  StatusListService,
  STATUS_LIST_TOKEN_TYP,
  decompressAndGetBit,
  StatusListFileSchema,
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
    issuerIdentifierMode: "did",
    port: 3000,
    enableLegacyVcFormat: false,
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

    for (let i = 0; i < 1024; i++) {
      service.allocateIndex();
    }

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

  it("rejects unallocated status indices for revoke, reactivate, and getStatus", () => {
    const service = new StatusListService(16);
    expect(service.allocatedCount).toBe(0);

    expect(() => service.getStatus(0)).toThrow("Status index 0 has not been allocated");
    expect(() => service.revoke(0)).toThrow("Status index 0 has not been allocated");
    expect(() => service.reactivate(0)).toThrow("Status index 0 has not been allocated");

    const allocated0 = service.allocateIndex();
    expect(allocated0).toBe(0);
    expect(service.getStatus(0)).toBe(0);
    expect(() => service.getStatus(1)).toThrow("Status index 1 has not been allocated");
    expect(() => service.revoke(1)).toThrow("Status index 1 has not been allocated");
    expect(() => service.reactivate(1)).toThrow("Status index 1 has not been allocated");
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
    for (let i = 0; i <= 42; i++) {
      service.allocateIndex();
    }
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
      for (let i = 0; i <= 10; i++) {
        service.allocateIndex();
      }
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

  describe("File Persistence & State Durability", () => {
    it("persists state to disk on state mutations and restores accurately on reload", () => {
      const testDir = join(tmpdir(), `unidipveri-status-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
      const filePath = join(testDir, "status-list.json");

      try {
        // Initial service instance
        const service1 = new StatusListService(64, filePath);
        expect(service1.allocatedCount).toBe(0);

        // Allocate indices and mutate state
        const idx0 = service1.allocateIndex();
        const idx1 = service1.allocateIndex();
        const idx2 = service1.allocateIndex();
        expect(idx0).toBe(0);
        expect(idx1).toBe(1);
        expect(idx2).toBe(2);
        expect(service1.allocatedCount).toBe(3);

        service1.revoke(idx1);
        expect(service1.isRevoked(idx1)).toBe(true);

        // Validate file content on disk
        expect(fs.existsSync(filePath)).toBe(true);
        const rawContent = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        const parsed = StatusListFileSchema.parse(rawContent);
        expect(parsed.version).toBe(1);
        expect(parsed.capacity).toBe(64);
        expect(parsed.allocatedCount).toBe(3);

        // Second service instance pointing to the same file
        const service2 = new StatusListService(64, filePath);
        expect(service2.allocatedCount).toBe(3);
        expect(service2.isRevoked(0)).toBe(false);
        expect(service2.isRevoked(1)).toBe(true);
        expect(service2.isRevoked(2)).toBe(false);

        // Additional allocation on service2
        const idx3 = service2.allocateIndex();
        expect(idx3).toBe(3);
        expect(service2.allocatedCount).toBe(4);

        // Reactivate idx1 on service2
        service2.reactivate(idx1);
        expect(service2.isRevoked(idx1)).toBe(false);

        // Third service instance validating reactivated state and incremented count
        const service3 = new StatusListService(64, filePath);
        expect(service3.allocatedCount).toBe(4);
        expect(service3.isRevoked(1)).toBe(false);
      } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("rejects corrupt or invalid status list files with descriptive errors", () => {
      const testDir = join(tmpdir(), `unidipveri-status-corrupt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
      const filePath = join(testDir, "status-list.json");
      fs.mkdirSync(testDir, { recursive: true });

      try {
        // 1. Invalid JSON
        fs.writeFileSync(filePath, "invalid-not-json", "utf-8");
        expect(() => new StatusListService(64, filePath)).toThrow(
          /contains invalid JSON/
        );

        // 2. Schema violation (missing required properties)
        fs.writeFileSync(filePath, JSON.stringify({ version: 1, capacity: 64 }), "utf-8");
        expect(() => new StatusListService(64, filePath)).toThrow(
          /failed schema validation/
        );

        // 3. Capacity mismatch
        fs.writeFileSync(
          filePath,
          JSON.stringify({
            version: 1,
            capacity: 128,
            allocatedCount: 0,
            bitArray: Buffer.alloc(16).toString("base64"),
            updatedAt: new Date().toISOString(),
          }),
          "utf-8"
        );
        expect(() => new StatusListService(64, filePath)).toThrow(
          /capacity mismatch: file has 128, but service configured with 64/
        );

        // 4. BitArray byte length mismatch
        fs.writeFileSync(
          filePath,
          JSON.stringify({
            version: 1,
            capacity: 64, // 64 bits = 8 bytes
            allocatedCount: 0,
            bitArray: Buffer.alloc(4).toString("base64"), // only 4 bytes
            updatedAt: new Date().toISOString(),
          }),
          "utf-8"
        );
        expect(() => new StatusListService(64, filePath)).toThrow(
          /bitArray byte length mismatch: expected 8 bytes, received 4 bytes/
        );

        // 5. Allocated count exceeds capacity
        fs.writeFileSync(
          filePath,
          JSON.stringify({
            version: 1,
            capacity: 64,
            allocatedCount: 65,
            bitArray: Buffer.alloc(8).toString("base64"),
            updatedAt: new Date().toISOString(),
          }),
          "utf-8"
        );
        expect(() => new StatusListService(64, filePath)).toThrow(
          "Invalid allocatedCount: 65 exceeds capacity 64"
        );
      } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });
  });
});
