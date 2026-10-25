import { describe, expect, it } from "bun:test";
import {
  didWebToUrl,
  resolveDidVerificationKey,
  resolveDidWeb,
  resolveIssuerKeyId,
  type DidDocument,
  type FetchLike,
} from "../src/did/did-resolver.js";

describe("W3C did:web Resolver (packages/core)", () => {
  describe("didWebToUrl transformation", () => {
    it("transforms simple domain to /.well-known/did.json", () => {
      expect(didWebToUrl("did:web:example.edu")).toBe(
        "https://example.edu/.well-known/did.json"
      );
    });

    it("transforms domain with subpaths to /path/did.json", () => {
      expect(didWebToUrl("did:web:example.edu:departments:engineering")).toBe(
        "https://example.edu/departments/engineering/did.json"
      );
    });

    it("decodes percent-encoded port and uses http for localhost", () => {
      expect(didWebToUrl("did:web:localhost%3A3000")).toBe(
        "http://localhost:3000/.well-known/did.json"
      );
      expect(didWebToUrl("did:web:localhost%3A8080:registrar")).toBe(
        "http://localhost:8080/registrar/did.json"
      );
    });

    it("uses http for 127.0.0.1 in local development", () => {
      expect(didWebToUrl("did:web:127.0.0.1%3A3000")).toBe(
        "http://127.0.0.1:3000/.well-known/did.json"
      );
    });

    it("rejects unsupported DID methods", () => {
      expect(() => didWebToUrl("did:key:z6MkhaXgBZDvotDkL5257faiz4898X77CP23m3394")).toThrow(
        /Unsupported DID method/
      );
      expect(() => didWebToUrl("did:ion:123456")).toThrow(/Unsupported DID method/);
    });

    it("rejects empty domain component", () => {
      expect(() => didWebToUrl("did:web:")).toThrow(/Invalid did:web identifier/);
    });
  });

  describe("resolveDidWeb", () => {
    const validDoc: DidDocument = {
      "@context": [
        "https://www.w3.org/ns/did/v1",
        "https://w3id.org/security/suites/jws-2020/v1",
      ],
      id: "did:web:example.edu",
      verificationMethod: [
        {
          id: "did:web:example.edu#key-1",
          type: "JsonWebKey2020",
          controller: "did:web:example.edu",
          publicKeyJwk: {
            kty: "EC",
            crv: "P-256",
            x: "test-x",
            y: "test-y",
          },
        },
      ],
      assertionMethod: ["did:web:example.edu#key-1"],
    };

    it("successfully fetches and validates a valid DID document", async () => {
      const mockFetch: FetchLike = async () => {
        return new Response(JSON.stringify(validDoc), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      const doc = await resolveDidWeb("did:web:example.edu", mockFetch);
      expect(doc.id).toBe("did:web:example.edu");
      expect(doc.verificationMethod?.[0].id).toBe("did:web:example.edu#key-1");
    });

    it("rejects when network fetch fails", () => {
      const failingFetch: FetchLike = async () => {
        throw new Error("DNS resolution failed");
      };

      expect(
            resolveDidWeb("did:web:example.edu", failingFetch)
        ).rejects.toThrow(/Network failure resolving DID/);
    });

    it("rejects when HTTP status is not ok", () => {
      const notFoundFetch: FetchLike = async () => {
        return new Response("Not Found", { status: 404, statusText: "Not Found" });
      };

      expect(
            resolveDidWeb("did:web:example.edu", notFoundFetch)
        ).rejects.toThrow(/HTTP status 404 Not Found/);
    });

    it("rejects when response body is not valid JSON", () => {
      const invalidJsonFetch: FetchLike = async () => {
        return new Response("<html>Not JSON</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      };

      expect(
            resolveDidWeb("did:web:example.edu", invalidJsonFetch)
        ).rejects.toThrow(/Invalid JSON in DID document/);
    });

    it("rejects when DID document schema is invalid", () => {
      const invalidSchemaFetch: FetchLike = async () => {
        return new Response(JSON.stringify({ notAValidDidDoc: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      expect(
            resolveDidWeb("did:web:example.edu", invalidSchemaFetch)
        ).rejects.toThrow(/Invalid DID document schema/);
    });

    it("rejects when document id does not match requested DID", () => {
      const mismatchedDoc = { ...validDoc, id: "did:web:other-domain.edu" };
      const mismatchedFetch: FetchLike = async () => {
        return new Response(JSON.stringify(mismatchedDoc), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      expect(
            resolveDidWeb("did:web:example.edu", mismatchedFetch)
        ).rejects.toThrow(/DID Document 'id' mismatch/);
    });
  });

  describe("resolveDidVerificationKey", () => {
    const docWithMultipleKeys: DidDocument = {
      "@context": "https://www.w3.org/ns/did/v1",
      id: "did:web:university.edu",
      verificationMethod: [
        {
          id: "did:web:university.edu#key-1",
          type: "JsonWebKey2020",
          controller: "did:web:university.edu",
          publicKeyJwk: {
            kty: "EC",
            crv: "P-256",
            x: "key1-x",
            y: "key1-y",
          },
        },
        {
          id: "did:web:university.edu#key-2",
          type: "JsonWebKey2020",
          controller: "did:web:university.edu",
          publicKeyJwk: {
            kty: "OKP",
            crv: "Ed25519",
            x: "key2-x",
          },
        },
      ],
    };

    const mockFetch: FetchLike = async () => {
      return new Response(JSON.stringify(docWithMultipleKeys), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    it("resolves specific key by short keyId (e.g. key-2)", async () => {
      const result = await resolveDidVerificationKey(
        "did:web:university.edu",
        "key-2",
        mockFetch
      );
      expect(result.keyId).toBe("did:web:university.edu#key-2");
      expect(result.publicKeyJwk.crv).toBe("Ed25519");
    });

    it("resolves specific key by full URI id", async () => {
      const result = await resolveDidVerificationKey(
        "did:web:university.edu",
        "did:web:university.edu#key-1",
        mockFetch
      );
      expect(result.keyId).toBe("did:web:university.edu#key-1");
      expect(result.publicKeyJwk.crv).toBe("P-256");
    });

    it("defaults to first key when keyId is omitted", async () => {
      const result = await resolveDidVerificationKey(
        "did:web:university.edu",
        undefined,
        mockFetch
      );
      expect(result.keyId).toBe("did:web:university.edu#key-1");
      expect(result.publicKeyJwk.crv).toBe("P-256");
    });

    it("rejects when requested keyId does not exist", () => {
      expect(
            resolveDidVerificationKey(
                "did:web:university.edu",
                "non-existent-key",
                mockFetch
            )
        ).rejects.toThrow(/Verification method 'non-existent-key' not found/);
    });

    it("rejects when matched verificationMethod lacks publicKeyJwk", () => {
      const docNoJwk: DidDocument = {
        "@context": "https://www.w3.org/ns/did/v1",
        id: "did:web:university.edu",
        verificationMethod: [
          {
            id: "did:web:university.edu#raw-key",
            type: "Ed25519VerificationKey2020",
            controller: "did:web:university.edu",
          },
        ],
      };

      const fetchNoJwk: FetchLike = async () => {
        return new Response(JSON.stringify(docNoJwk), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      expect(
            resolveDidVerificationKey("did:web:university.edu", "raw-key", fetchNoJwk)
        ).rejects.toThrow(/does not contain a 'publicKeyJwk'/);
    });
  });

  describe("resolveIssuerKeyId", () => {
    it("formats bare keyId as absolute DID URL when issuer is a DID", () => {
      expect(
        resolveIssuerKeyId("did:web:example.edu", "key-1")
      ).toBe("did:web:example.edu#key-1");
    });

    it("formats relative fragment keyId as absolute DID URL when issuer is a DID", () => {
      expect(
        resolveIssuerKeyId("did:web:example.edu", "#key-1")
      ).toBe("did:web:example.edu#key-1");
    });

    it("preserves already fully-qualified DID URL keyId", () => {
      expect(
        resolveIssuerKeyId("did:web:example.edu", "did:web:example.edu#key-1")
      ).toBe("did:web:example.edu#key-1");
    });

    it("preserves bare keyId when issuer is an HTTPS URL", () => {
      expect(
        resolveIssuerKeyId("https://issuer.example.edu", "key-1")
      ).toBe("key-1");
    });
  });
});

