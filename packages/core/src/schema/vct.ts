/**
 * Canonical VCT (Verifiable Credential Type) URI resolution.
 *
 * Implements draft-ietf-oauth-sd-jwt-vc-19 credential type (vct) and Type Metadata URI resolution.
 * Provides the single canonical function for joining schema vctPath and base URL.
 */

/**
 * Resolves a schema vctPath and base URL into a canonical, absolute VCT URI.
 *
 * Requirements:
 * - vctPath must be a non-empty string starting with '/'.
 * - vctBaseUrl must be a non-empty string.
 * - Normalizes trailing slashes on vctBaseUrl and leading slashes on vctPath.
 * - Validates that the resulting joined string forms a syntactically valid URL.
 *
 * @param vctPath Relative URL path of the credential type (e.g. "/types/graduation-record/v1")
 * @param vctBaseUrl Base URL of the schema authority or issuer (e.g. "https://issuer.university.edu" or "http://localhost:3000")
 * @returns Fully qualified, canonical VCT URI
 * @throws Error if vctPath or vctBaseUrl are invalid or cannot form a valid URL
 */
export function resolveVct(vctPath: string, vctBaseUrl: string): string {
  if (typeof vctPath !== "string" || !vctPath.startsWith("/")) {
    throw new Error(
      `vctPath must be a non-empty string starting with '/' (received: '${String(vctPath)}')`
    );
  }

  if (typeof vctBaseUrl !== "string" || vctBaseUrl.trim().length === 0) {
    throw new Error("vctBaseUrl must be a non-empty string");
  }

  const cleanBase = vctBaseUrl.trim().replace(/\/+$/, "");
  const cleanPath = vctPath.trim().replace(/^\/+/, "/");
  const joined = `${cleanBase}${cleanPath}`;

  try {
    const parsed = new URL(joined);
    if (!parsed.protocol || !parsed.host) {
      throw new Error("URL must include protocol and host");
    }
  } catch (err) {
    throw new Error(
      `Resolved VCT '${joined}' is not a valid URL: ${(err as Error).message}`
    );
  }

  return joined;
}
