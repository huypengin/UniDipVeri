import { describe, expect, it } from "bun:test";
import { Resolver } from "did-resolver";
import { getResolver } from "web-did-resolver";
import {
  resolveDidVerificationKey,
  resolveDidWeb,
  type DidDocument,
} from "../src/did/did-resolver.js";

describe("W3C did:web Second Resolver Cross-Validation (DIF web-did-resolver)", () => {
  const sampleDidDoc: DidDocument = {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/suites/jws-2020/v1",
    ],
    id: "did:web:university.edu",
    controller: "did:web:university.edu",
    verificationMethod: [
      {
        id: "did:web:university.edu#key-1",
        type: "JsonWebKey2020",
        controller: "did:web:university.edu",
        publicKeyJwk: {
          kty: "EC",
          crv: "P-256",
          x: "f83OJ3D2xFMTbKEGaJtNYEvV6zWLbU39uLF88ndKEGY",
          y: "x_da6tKZ3K47_3CRMW79-Z652j36a85m228U9EpN575",
        },
      },
    ],
    authentication: ["did:web:university.edu#key-1"],
    assertionMethod: ["did:web:university.edu#key-1"],
  };

  it("resolves and cross-validates full DID document between native resolver and DIF web-did-resolver", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "https://university.edu/.well-known/did.json") {
          return new Response(JSON.stringify(sampleDidDoc), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      }) as unknown as typeof fetch;

      // 1. Resolve using UniDipVeri native resolver
      const nativeDoc = await resolveDidWeb("did:web:university.edu");
      expect(nativeDoc.id).toBe("did:web:university.edu");
      expect(nativeDoc.controller).toBe("did:web:university.edu");
      expect(nativeDoc.verificationMethod?.[0].id).toBe("did:web:university.edu#key-1");

      // 2. Resolve using DIF official web-did-resolver
      const webResolver = getResolver();
      const difResolver = new Resolver({ ...webResolver });
      const difResult = await difResolver.resolve("did:web:university.edu");

      expect(difResult.didResolutionMetadata.error).toBeUndefined();
      expect(difResult.didDocument).toBeDefined();
      expect(difResult.didDocument?.id).toBe(nativeDoc.id);
      expect(difResult.didDocument?.controller).toBe(nativeDoc.controller);
      expect(difResult.didDocument?.verificationMethod?.[0].id).toBe(
        nativeDoc.verificationMethod?.[0].id
      );
      expect(difResult.didDocument?.verificationMethod?.[0].publicKeyJwk).toEqual(
        nativeDoc.verificationMethod?.[0].publicKeyJwk
      );
      expect(difResult.didDocument?.assertionMethod).toEqual(
        nativeDoc.assertionMethod as any
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("normalizes incomplete document missing @context, controller, and assertionMethod and satisfies DIF resolver", async () => {
    const incompleteDoc = {
      id: "did:web:dept.university.edu",
      verificationMethod: [
        {
          id: "did:web:dept.university.edu#key-omega",
          type: "JsonWebKey2020",
          publicKeyJwk: {
            kty: "EC",
            crv: "P-256",
            x: "test-x",
            y: "test-y",
          },
        },
      ],
    };

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "https://dept.university.edu/.well-known/did.json") {
          return new Response(JSON.stringify(incompleteDoc), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      }) as unknown as typeof fetch;

      // Native resolver loads and normalizes missing fields
      const nativeDoc = await resolveDidWeb("did:web:dept.university.edu");
      expect(nativeDoc["@context"]).toEqual(["https://www.w3.org/ns/did/v1"]);
      expect(nativeDoc.controller).toBe("did:web:dept.university.edu");
      expect(nativeDoc.verificationMethod?.[0].controller).toBe(
        "did:web:dept.university.edu"
      );
      expect(nativeDoc.assertionMethod).toEqual([
        "did:web:dept.university.edu#key-omega",
      ]);

      // Verify that the normalized document can be resolved cleanly by DIF resolver
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify(nativeDoc), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const webResolver = getResolver();
      const difResolver = new Resolver({ ...webResolver });
      const difResult = await difResolver.resolve("did:web:dept.university.edu");

      expect(difResult.didResolutionMetadata.error).toBeUndefined();
      expect(difResult.didDocument?.id).toBe("did:web:dept.university.edu");
      expect(difResult.didDocument?.controller).toBe("did:web:dept.university.edu");
      expect(difResult.didDocument?.assertionMethod).toContain(
        "did:web:dept.university.edu#key-omega"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("extracts verification key accurately through both resolver pathways", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify(sampleDidDoc), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const keyResult = await resolveDidVerificationKey(
        "did:web:university.edu",
        "key-1"
      );
      expect(keyResult.keyId).toBe("did:web:university.edu#key-1");
      expect(keyResult.publicKeyJwk.crv).toBe("P-256");

      const webResolver = getResolver();
      const difResolver = new Resolver({ ...webResolver });
      const difResult = await difResolver.resolve("did:web:university.edu");
      const difVm = difResult.didDocument?.verificationMethod?.find(
        (vm) => vm.id === keyResult.keyId
      );

      expect(difVm).toBeDefined();
      expect(difVm?.publicKeyJwk).toEqual(keyResult.publicKeyJwk);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
