import { z } from "zod";
import {
  SigningAlgorithmSchema,
  type SigningAlgorithm,
} from "@unidipveri/core";

export type { SigningAlgorithm };

/**
 * Validates protocol and host security constraints for URLs based on environment.
 *
 * Requirements:
 * - Production (NODE_ENV=production): MUST use https://. Insecure http:// throws.
 * - Development/Test: http:// allowed only for loopback addresses (localhost, 127.0.0.1, [::1]).
 *
 * @param urlStr URL to validate
 * @param fieldName Field name for error message
 * @param isProduction Whether running in production
 */
export function validateSecurityUrl(
  urlStr: string,
  fieldName: string,
  isProduction: boolean
): void {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Issuer configuration error: ${fieldName} must be a valid URL`);
  }

  if (isProduction) {
    if (parsed.protocol !== "https:") {
      throw new Error(
        `Production configuration error: ${fieldName} must use https:// in production (received: '${urlStr}')`
      );
    }
  } else {
    if (parsed.protocol === "http:") {
      const isLoopback =
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "[::1]" ||
        parsed.hostname === "::1";
      if (!isLoopback) {
        throw new Error(
          `Development configuration error: Insecure HTTP ${fieldName} allowed only for localhost/127.0.0.1 (received: '${urlStr}')`
        );
      }
    }
  }
}

/**
 * Strict schema for Issuer application configuration.
 */
export const IssuerConfigSchema = z.object({
  /** HTTP server listening port */
  port: z.coerce
    .number()
    .int("port must be an integer")
    .min(1, "port must be between 1 and 65535")
    .max(65535, "port must be between 1 and 65535")
    .default(3000),

  /** Canonical base URL where the issuer service is accessible */
  baseUrl: z
    .string()
    .url("baseUrl must be a valid HTTP or HTTPS URL")
    .transform((url) => url.replace(/\/+$/, "")), // Strip trailing slash

  /** Fixed base URL used to resolve credential vctPath into an absolute VCT URI */
  vctBaseUrl: z
    .string()
    .url("vctBaseUrl must be a valid HTTP or HTTPS URL")
    .transform((url) => url.replace(/\/+$/, "")), // Strip trailing slash

  /** Issuer DID identifier conforming to W3C DID v1.0 */
  issuerDid: z
    .string()
    .min(1, "issuerDid cannot be empty")
    .refine((val) => val.startsWith("did:"), {
      message: "issuerDid must start with 'did:' (e.g. did:web:example.edu)",
    }),

  /**
   * Issuer identifier mode controlling the format of the 'iss' claim in credentials
   * and status list tokens:
   * - 'did': Uses issuerDid (e.g. did:web:example.edu) with /.well-known/did.json (Variant A)
   * - 'https': Uses baseUrl (e.g. https://example.edu) with /.well-known/jwt-vc-issuer (Variant B)
   */
  issuerIdentifierMode: z.enum(["did", "https"]).default("did"),

  /** Key identifier in DID document and outer JWS header 'kid' */
  keyId: z.string().min(1, "keyId cannot be empty").default("key-1"),

  /** Cryptographic algorithm for outer SD-JWT VC signatures (RFC 8725 BCP) */
  signingAlgorithm: SigningAlgorithmSchema.default("ES256"),

  /** Explicit path to credential schema YAML */
  schemaPath: z
    .string({
      required_error: "schemaPath must be provided",
      invalid_type_error: "schemaPath must be provided",
    })
    .min(1, "schemaPath must be provided"),

  /** Optional raw private JWK string. If omitted, an ephemeral key is generated for development/testing */
  privateKeyJwkJson: z.string().optional(),

  /** Optional file path for persisting Token Status List state across server restarts */
  statusListPath: z.string().optional(),
});

export type IssuerConfig = z.infer<typeof IssuerConfigSchema>;

/**
 * Resolves the effective issuer identifier for credentials and status tokens
 * based on the configured issuerIdentifierMode.
 *
 * @param config Validated IssuerConfig
 * @returns Base URL if mode is 'https', otherwise issuerDid
 */
export function getEffectiveIssuer(config: IssuerConfig): string {
  return config.issuerIdentifierMode === "https" ? config.baseUrl : config.issuerDid;
}

/**
 * Loads and validates Issuer configuration from environment variables and optional overrides.
 *
 * @param overrides Optional environment variables map for testing
 * @returns Fully validated IssuerConfig object
 */
export function loadIssuerConfig(
  overrides: Record<string, string | undefined> = {}
): IssuerConfig {
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...overrides,
  };

  const port = env.PORT ?? "3000";
  const defaultBaseUrl = `http://localhost:${port}`;
  const defaultDid = `did:web:localhost%3A${port}`;

  const resolvedBaseUrl = env.ISSUER_BASE_URL ?? defaultBaseUrl;
  const rawVctBaseUrl =
    env.VCT_BASE_URL && env.VCT_BASE_URL.trim().length > 0
      ? env.VCT_BASE_URL
      : resolvedBaseUrl;

  const rawConfig = {
    port: env.PORT ?? 3000,
    baseUrl: resolvedBaseUrl,
    vctBaseUrl: rawVctBaseUrl,
    issuerDid: env.ISSUER_DID ?? defaultDid,
    issuerIdentifierMode: env.ISSUER_IDENTIFIER_MODE ?? "did",
    keyId: env.KEY_ID ?? "key-1",
    signingAlgorithm: env.SIGNING_ALGORITHM ?? "ES256",
    schemaPath: env.SCHEMA_PATH,
    privateKeyJwkJson: env.ISSUER_PRIVATE_KEY_JWK,
    statusListPath: env.STATUS_LIST_PATH,
  };

  const parseResult = IssuerConfigSchema.safeParse(rawConfig);
  if (!parseResult.success) {
    const errorDetails = parseResult.error.issues
      .map((issue) => `[${issue.path.join(".")}]: ${issue.message}`)
      .join(", ");
    throw new Error(`Issuer configuration validation failed: ${errorDetails}`);
  }

  const isProduction = env.NODE_ENV === "production";
  validateSecurityUrl(parseResult.data.baseUrl, "ISSUER_BASE_URL", isProduction);
  validateSecurityUrl(parseResult.data.vctBaseUrl, "VCT_BASE_URL", isProduction);

  if (isProduction) {
    if (
      !parseResult.data.privateKeyJwkJson ||
      parseResult.data.privateKeyJwkJson.trim().length === 0
    ) {
      throw new Error(
        "Production configuration error: ISSUER_PRIVATE_KEY_JWK must be provided in production mode"
      );
    }
  }

  return parseResult.data;
}
