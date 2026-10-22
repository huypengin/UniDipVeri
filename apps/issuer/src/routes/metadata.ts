import type { CredentialTypeConfig } from "@unidipveri/core";
import type { IssuerConfig } from "../config.js";
import { generateIssuerMetadata } from "../services/claims-metadata.js";

/**
 * Handles GET requests to /.well-known/openid-credential-issuer
 * conforming to OID4VCI 1.0 Final Credential Issuer Metadata specification.
 *
 * @param config Validated IssuerConfig
 * @param schemaConfig Validated CredentialTypeConfig
 * @returns HTTP Response with 200 OK and application/json metadata body
 */
export function handleMetadataRequest(
  config: IssuerConfig,
  schemaConfig: CredentialTypeConfig
): Response {
  const metadata = generateIssuerMetadata(config, schemaConfig);

  return Response.json(metadata, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * Handles GET requests to /.well-known/oauth-authorization-server and
 * /.well-known/openid-configuration conforming to RFC 8414.
 *
 * Provides authorization server metadata discovery for wallets implementing
 * RFC 8414 or earlier drafts of OpenID4VCI.
 *
 * @param config Validated IssuerConfig
 * @returns HTTP Response with 200 OK and application/json metadata body
 */
export function handleOAuthMetadataRequest(config: IssuerConfig): Response {
  const metadata = {
    issuer: config.baseUrl,
    authorization_endpoint: `${config.baseUrl}/credential-offer`,
    token_endpoint: `${config.baseUrl}/token`,
    token_endpoint_auth_methods_supported: ["none"],
    grant_types_supported: [
      "urn:ietf:params:oauth:grant-type:pre-authorized_code",
    ],
    response_types_supported: [],
    code_challenge_methods_supported: [],
  };

  return Response.json(metadata, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

