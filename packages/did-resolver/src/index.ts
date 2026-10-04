/**
 * @unidipveri/did-resolver
 * 
 * Stub module scheduled for implementation alongside OID4VP/verifier flows.
 * Responsible for resolving `did:web` documents, extracting JWKs, and dereferencing
 * VCT metadata service endpoints.
 */

export interface DidResolutionResult {
  did: string;
  keys: Array<{ id: string; alg: string; jwk: Record<string, unknown> }>;
  vctEndpoint?: string;
}

export async function resolveDidDoc(did: string): Promise<DidResolutionResult> {
  // Placeholder implementation for Week 1
  return {
    did,
    keys: [],
  };
}
