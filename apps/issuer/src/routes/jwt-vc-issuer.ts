import type { IssuerConfig } from "../config.js";
import type { KeyContext } from "../services/key-manager.js";

/**
 * SD-JWT VC Issuer Metadata Document per draft-ietf-oauth-sd-jwt-vc.
 *
 * Provides standalone verifiers with the issuer's identifier and public JWKS
 * when the credential issuer is an HTTPS URL (Variant B).
 */
export interface JwtVcIssuerMetadata {
  issuer: string;
  jwks: {
    keys: Array<Record<string, unknown>>;
  };
}

/**
 * Generates the SD-JWT VC Issuer Metadata document.
 *
 * Enforces:
 * 1. issuer identical to config.baseUrl.
 * 2. jwks contains the public JWK with kid matching keyContext.keyId.
 * 3. Mutual exclusivity: jwks is provided, jwks_uri is omitted.
 *
 * @param config Validated IssuerConfig
 * @param keyContext Initialized KeyContext with sanitized public key
 * @returns JwtVcIssuerMetadata document
 */
export function generateJwtVcIssuerMetadata(
  config: IssuerConfig,
  keyContext: KeyContext
): JwtVcIssuerMetadata {
  const publicJwk: Record<string, unknown> = {
    ...keyContext.publicKeyJwk,
    kid: keyContext.keyId,
    alg: keyContext.alg,
    use: "sig",
  };

  return {
    issuer: config.baseUrl,
    jwks: {
      keys: [publicJwk],
    },
  };
}

/**
 * Handles GET and HEAD requests to /.well-known/jwt-vc-issuer.
 *
 * @param config Validated IssuerConfig
 * @param keyContext Initialized KeyContext
 * @returns HTTP Response with 200 OK and application/json metadata
 */
export function handleJwtVcIssuerRequest(
  config: IssuerConfig,
  keyContext: KeyContext
): Response {
  const metadata = generateJwtVcIssuerMetadata(config, keyContext);

  return Response.json(metadata, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
