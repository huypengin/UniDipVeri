import * as jose from "jose";
import { z } from "zod";

/**
 * W3C DID Document Verification Method Schema.
 */
export const VerificationMethodSchema = z.object({
  id: z.string().min(1, "VerificationMethod 'id' cannot be empty"),
  type: z.string().min(1, "VerificationMethod 'type' cannot be empty"),
  controller: z.string().min(1, "VerificationMethod 'controller' cannot be empty"),
  publicKeyJwk: z
    .custom<jose.JWK>(
      (val) => typeof val === "object" && val !== null && !Array.isArray(val)
    )
    .optional(),
});

export type VerificationMethod = z.infer<typeof VerificationMethodSchema>;

/**
 * W3C DID Document Service Endpoint Schema.
 */
export const DidServiceSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  serviceEndpoint: z.string().min(1),
});

export type DidService = z.infer<typeof DidServiceSchema>;

/**
 * W3C DID Document Schema conforming to W3C DID v1.0.
 */
export const DidDocumentSchema = z.object({
  "@context": z.union([z.string(), z.array(z.string())]),
  id: z.string().startsWith("did:", "DID id must start with 'did:'"),
  verificationMethod: z.array(VerificationMethodSchema).optional(),
  authentication: z.array(z.union([z.string(), VerificationMethodSchema])).optional(),
  assertionMethod: z.array(z.union([z.string(), VerificationMethodSchema])).optional(),
  service: z.array(DidServiceSchema).optional(),
});

export type DidDocument = z.infer<typeof DidDocumentSchema>;

/**
 * Translates a did:web identifier into its canonical HTTPS URL per W3C did:web Method Specification.
 *
 * Examples:
 *   did:web:example.edu -> https://example.edu/.well-known/did.json
 *   did:web:example.edu:user:alice -> https://example.edu/user/alice/did.json
 *   did:web:localhost%3A3000 -> http://localhost:3000/.well-known/did.json
 *
 * @param did The did:web URI to convert
 * @returns Fully qualified URL string
 */
export function didWebToUrl(did: string): string {
  if (!did.startsWith("did:web:")) {
    throw new Error(`Unsupported DID method: expected 'did:web:...', received '${did}'`);
  }

  const parts = did.slice("did:web:".length).split(":");
  if (parts.length === 0 || !parts[0]) {
    throw new Error(`Invalid did:web identifier: empty domain component in '${did}'`);
  }

  // Decode domain (handles percent-encoded ports, e.g. localhost%3A3000 -> localhost:3000)
  const rawDomain = parts[0];
  const domain = decodeURIComponent(rawDomain);

  // Use http for localhost / 127.0.0.1 in local development, https for all others
  const isLocal =
    domain.startsWith("localhost") ||
    domain.startsWith("127.0.0.1") ||
    domain.startsWith("::1");
  const protocol = isLocal ? "http" : "https";

  if (parts.length === 1) {
    return `${protocol}://${domain}/.well-known/did.json`;
  }

  const pathSegments = parts
    .slice(1)
    .map((seg) => decodeURIComponent(seg))
    .join("/");

  return `${protocol}://${domain}/${pathSegments}/did.json`;
}

/**
 * Compatible fetch function signature for HTTP DID dereferencing.
 */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

/**
 * Resolves a did:web identifier by fetching its DID document over HTTP/HTTPS.
 *
 * @param did The did:web URI to resolve
 * @param fetchFn Optional custom fetch function (defaults to global fetch)
 * @returns Validated W3C DidDocument
 */
export async function resolveDidWeb(
  did: string,
  fetchFn: FetchLike = fetch
): Promise<DidDocument> {
  const url = didWebToUrl(did);

  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: {
        Accept: "application/json, application/did+json",
      },
    });
  } catch (err) {
    throw new Error(
      `Network failure resolving DID '${did}' at '${url}': ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Failed to resolve DID '${did}' at '${url}': HTTP status ${response.status} ${response.statusText}`
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    throw new Error(
      `Invalid JSON in DID document for '${did}' at '${url}': ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const parseResult = DidDocumentSchema.safeParse(json);
  if (!parseResult.success) {
    throw new Error(
      `Invalid DID document schema for '${did}': ${parseResult.error.message}`
    );
  }

  const doc = parseResult.data;
  if (doc.id !== did) {
    throw new Error(
      `DID Document 'id' mismatch: expected '${did}', but document declared '${doc.id}'`
    );
  }

  return doc;
}

/**
 * Resolves a public verification JWK from a did:web identifier and optional key ID.
 *
 * Searches `verificationMethod` and `assertionMethod` in the resolved DID Document.
 *
 * @param did The did:web URI to resolve
 * @param keyId Optional specific key ID to find (e.g. "key-1" or "did:web:example.edu#key-1")
 * @param fetchFn Optional custom fetch function
 * @returns The matched keyId and its public JWK
 */
export async function resolveDidVerificationKey(
  did: string,
  keyId?: string,
  fetchFn: FetchLike = fetch
): Promise<{ keyId: string; publicKeyJwk: jose.JWK }> {
  const doc = await resolveDidWeb(did, fetchFn);

  const methods = doc.verificationMethod ?? [];
  if (methods.length === 0) {
    throw new Error(
      `DID Document for '${did}' contains no verificationMethod entries`
    );
  }

  let matched: VerificationMethod | undefined;

  if (keyId) {
    matched = methods.find(
      (m) =>
        m.id === keyId ||
        m.id === `${did}#${keyId}` ||
        m.id.endsWith(`#${keyId}`)
    );
    if (!matched) {
      throw new Error(
        `Verification method '${keyId}' not found in DID document for '${did}'`
      );
    }
  } else {
    // If keyId is omitted, pick the first method referenced in assertionMethod or first verificationMethod
    matched = methods[0];
  }

  if (!matched.publicKeyJwk) {
    throw new Error(
      `Verification method '${matched.id}' for '${did}' does not contain a 'publicKeyJwk'`
    );
  }

  return {
    keyId: matched.id,
    publicKeyJwk: matched.publicKeyJwk,
  };
}

/**
 * Resolves an issuer and keyId into a canonical verification method DID URL if the issuer is a DID.
 * Per W3C DID Core and draft-ietf-oauth-sd-jwt-vc-19 verification method formatting requirements,
 * verification methods referenced outside the DID document must be formatted as DID URLs.
 *
 * @param issuer Issuer URI or DID (e.g. "did:web:example.edu")
 * @param keyId Key identifier or fragment (e.g. "key-1", "#key-1", or full DID URL)
 * @returns Fully qualified DID URL if issuer is a DID, otherwise original keyId
 */
export function resolveIssuerKeyId(issuer: string, keyId: string): string {
  if (issuer.startsWith("did:")) {
    if (keyId.startsWith("did:")) {
      return keyId;
    }
    if (keyId.startsWith("#")) {
      return `${issuer}${keyId}`;
    }
    return `${issuer}#${keyId}`;
  }
  return keyId;
}
