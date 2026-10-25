import type { IssuerConfig } from "../config.js";
import type { KeyContext } from "../services/key-manager.js";

/**
 * Generates a W3C-compliant DID Document for the issuer per W3C DID v1.0 and did:web specification.
 *
 * Exposes the issuer's verificationMethod with sanitized public JWK and openid-credential-issuer service endpoint.
 *
 * @param config Validated IssuerConfig
 * @param keyContext Initialized KeyContext with sanitized public key
 * @returns W3C DidDocument object
 */
export function generateDidDocument(
  config: IssuerConfig,
  keyContext: KeyContext
) {
  const { issuerDid, baseUrl } = config;
  const keyUri = `${issuerDid}#${keyContext.keyId}`;

  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/suites/jws-2020/v1",
    ],
    id: issuerDid,
    controller: issuerDid,
    verificationMethod: [
      {
        id: keyUri,
        type: "JsonWebKey2020",
        controller: issuerDid,
        publicKeyJwk: keyContext.publicKeyJwk,
      },
    ],
    authentication: [keyUri],
    assertionMethod: [keyUri],
    service: [
      {
        id: `${issuerDid}#openid-credential-issuer`,
        type: "CredentialIssuer",
        serviceEndpoint: baseUrl,
      },
    ],
  };
}

/**
 * Handles GET requests to /.well-known/did.json.
 *
 * @param config Validated IssuerConfig
 * @param keyContext Initialized KeyContext
 * @returns HTTP Response with 200 OK and application/json DID document
 */
export function handleDidRequest(
  config: IssuerConfig,
  keyContext: KeyContext
): Response {
  const doc = generateDidDocument(config, keyContext);

  return Response.json(doc, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
