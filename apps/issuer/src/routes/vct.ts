import type { CredentialTypeConfig } from "@unidipveri/core";
import { generateTypeMetadata } from "../services/claims-metadata.js";

/**
 * Handles GET requests to SD-JWT VC Type Metadata endpoints (/types/*)
 * conforming to draft-ietf-oauth-sd-jwt-vc-19 Section 5.
 *
 * Verifiers dereference the credential's 'vct' URI to fetch this document.
 *
 * @param pathname URL pathname requested
 * @param schemaConfig Validated CredentialTypeConfig
 * @param vctBaseUrl Canonical base URL for resolving vctPath
 * @returns HTTP Response with 200 OK and type metadata, or 404 Not Found
 */
export function handleVctRequest(
  pathname: string,
  schemaConfig: CredentialTypeConfig,
  vctBaseUrl: string
): Response {
  const normalizedVctPath = schemaConfig.vctPath.replace(/\/+$/, "");
  const normalizedPath = pathname.replace(/\/+$/, "");

  // Match exact vct path, or /types wildcard matching the type
  const isMatch =
    normalizedPath === normalizedVctPath ||
    normalizedPath === "/types" ||
    normalizedVctPath.endsWith(normalizedPath) ||
    normalizedPath.endsWith(
      normalizedVctPath.split("/").filter(Boolean).pop() ?? ""
    );

  if (!isMatch) {
    return Response.json(
      {
        error: "not_found",
        error_description: `Type metadata not found for requested path: ${pathname}`,
      },
      {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  const typeMetadata = generateTypeMetadata(schemaConfig, vctBaseUrl);

  return Response.json(typeMetadata, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
