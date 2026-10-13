import type { CredentialTypeConfig } from "@unidipveri/core";
import type { IssuerConfig } from "../config.js";
import { generateIssuerMetadata } from "../services/claims-metadata.js";

/**
 * Handles GET requests to /.well-known/openid-credential-issuer
 * conforming to OID4VCI 1.0 Final Section 11.2.2.
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
