import {
  resolveVct,
  type ClaimDef,
  type ClaimType,
  type CredentialTypeConfig,
} from "@unidipveri/core";
import type { IssuerConfig } from "../config.js";

/**
 * Claim display metadata conforming to OID4VCI 1.0 Final.
 */
export interface Oid4vciClaimDisplay {
  name: string;
  locale: string;
}

/**
 * Claim metadata definition conforming to OID4VCI 1.0 Final.
 */
export interface Oid4vciClaimMetadata {
  mandatory: boolean;
  value_type: ClaimType;
  display?: Oid4vciClaimDisplay[];
}

/**
 * Supported credential configuration conforming to OID4VCI 1.0 Final
 * and draft-ietf-oauth-sd-jwt-vc-19.
 */
export interface CredentialConfigurationSupported {
  format: "dc+sd-jwt";
  scope: string;
  vct: string;
  cryptographic_binding_methods_supported: string[];
  credential_signing_alg_values_supported: string[];
  proof_types_supported: {
    jwt: {
      proof_signing_alg_values_supported: string[];
    };
  };
  display: Array<{
    name: string;
    locale: string;
    background_color?: string;
    text_color?: string;
  }>;
  claims: Record<string, Oid4vciClaimMetadata>;
}

/**
 * Full OID4VCI Credential Issuer Metadata document conforming to
 * OID4VCI 1.0 Final.
 */
export interface Oid4vciIssuerMetadata {
  credential_issuer: string;
  credential_endpoint: string;
  token_endpoint: string;
  nonce_endpoint?: string;
  authorization_servers?: string[];
  authorization_server?: string;
  credential_configurations_supported: Record<
    string,
    CredentialConfigurationSupported
  >;
  credentials_supported?: Array<Record<string, unknown>>;
}

/**
 * Localized claim display metadata in Type Metadata per draft-ietf-oauth-sd-jwt-vc-19.
 */
export interface SdJwtVcTypeClaimDisplay {
  lang?: string;
  locale?: string;
  label?: string;
  name?: string;
  description?: string;
}

/**
 * Claim metadata definition inside Type Metadata claims array per draft-ietf-oauth-sd-jwt-vc-19.
 */
export interface SdJwtVcTypeMetadataClaim {
  path: Array<string | number | null>;
  display?: SdJwtVcTypeClaimDisplay[];
  sd?: "always" | "never" | "allowed";
  mandatory?: boolean;
}

/**
 * SD-JWT VC Type Metadata document conforming to
 * draft-ietf-oauth-sd-jwt-vc-19.
 */
export interface SdJwtVcTypeMetadata {
  vct: string;
  name: string;
  description: string;
  schema: Record<string, unknown>;
  display?: Array<{
    lang?: string;
    locale?: string;
    name?: string;
    description?: string;
  }>;
  claims: SdJwtVcTypeMetadataClaim[];
}

/**
 * Formats a camelCase or snake_case claim property identifier into a clean,
 * human-readable title suitable for wallet display per OID4VCI 1.0 Final.
 *
 * Examples:
 *   studentId -> "Student ID"
 *   fullName -> "Full Name"
 *   dateOfBirth -> "Date Of Birth"
 *   cumulativeGPA -> "Cumulative GPA"
 *
 * @param key Identifier to format
 * @returns Human-readable label string
 */
export function formatClaimDisplayName(key: string): string {
  const acronyms: Record<string, string> = {
    id: "ID",
    gpa: "GPA",
    url: "URL",
    uri: "URI",
    dob: "DOB",
  };

  const words = key
    .replace(/([A-Z]+)/g, " $1")
    .trim()
    .split(/[\s_]+/);

  return words
    .map((word) => {
      const lower = word.toLowerCase();
      if (acronyms[lower]) {
        return acronyms[lower];
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * Derives a normalized configuration identifier key for credential_configurations_supported
 * based on the credential's vct URI or name.
 *
 * @param vct Credential type URI
 * @param name Credential human-readable name
 * @returns Identifier string (e.g. "graduation_record_sd_jwt_vc")
 */
export function deriveCredentialConfigurationId(
  vctPathOrUrl: string,
  name: string
): string {
  try {
    const pathname = vctPathOrUrl.startsWith("/")
      ? vctPathOrUrl
      : new URL(vctPathOrUrl).pathname;
    const segments = pathname.split("/").filter(Boolean);
    const typeSegment =
      segments.length >= 2
        ? segments[segments.length - 2]
        : segments[segments.length - 1];
    if (typeSegment) {
      return `${typeSegment.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}_sd_jwt_vc`;
    }
  } catch {
    // Fall back to deriving from name if parsing fails
  }
  return `${name.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}_sd_jwt_vc`;
}

/**
 * Derives the OAuth scope identifier from the credential name.
 *
 * @param name Credential human-readable name
 * @returns Scope string (e.g. "GraduationAcademicRecord")
 */
export function deriveScope(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, "");
}

/**
 * Derives the OID4VCI claims dictionary from schema ClaimDef mappings
 * conforming to OID4VCI 1.0 Final.
 *
 * @param claims Top-level schema claims map
 * @returns OID4VCI claim metadata dictionary
 */
export function deriveOid4vciClaims(
  claims: Record<string, ClaimDef>
): Record<string, Oid4vciClaimMetadata> {
  const result: Record<string, Oid4vciClaimMetadata> = {};

  for (const [key, def] of Object.entries(claims)) {
    result[key] = {
      mandatory: Boolean(def.required),
      value_type: def.type,
      display: [
        {
          name: formatClaimDisplayName(key),
          locale: "en-US",
        },
      ],
    };
  }

  return result;
}

/**
 * Derives a standard JSON Schema (Draft 2020-12) representation from CredentialTypeConfig
 * for inclusion in SD-JWT VC Type Metadata per draft-ietf-oauth-sd-jwt-vc-19.
 *
 * @param schemaConfig Fully validated CredentialTypeConfig
 * @returns Draft 2020-12 JSON Schema object
 */
export function deriveJsonSchema(
  schemaConfig: CredentialTypeConfig
): Record<string, unknown> {
  function mapClaimToJsonSchema(def: ClaimDef): Record<string, unknown> {
    const property: Record<string, unknown> = {
      type: def.type,
    };

    if (def.format) {
      property.format = def.format;
    }

    if (def.description) {
      property.description = def.description;
    }

    if (def.type === "object" && def.properties) {
      const nestedProperties: Record<string, unknown> = {};
      const requiredList: string[] = [];

      for (const [propKey, propDef] of Object.entries(def.properties)) {
        nestedProperties[propKey] = mapClaimToJsonSchema(propDef);
        if (propDef.required) {
          requiredList.push(propKey);
        }
      }

      property.properties = nestedProperties;
      if (requiredList.length > 0) {
        property.required = requiredList;
      }
    }

    if (def.type === "array" && def.items) {
      property.items = mapClaimToJsonSchema(def.items);
    }

    return property;
  }

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, def] of Object.entries(schemaConfig.claims)) {
    properties[key] = mapClaimToJsonSchema(def);
    if (def.required) {
      required.push(key);
    }
  }

  const schemaObj: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties,
  };

  if (required.length > 0) {
    schemaObj.required = required;
  }

  return schemaObj;
}

/**
 * Generates the full OID4VCI Credential Issuer Metadata document
 * conforming to OID4VCI 1.0 Final.
 *
 * @param config Validated IssuerConfig
 * @param schemaConfig Loaded CredentialTypeConfig
 * @returns Compliant Oid4vciIssuerMetadata object
 */
export function generateIssuerMetadata(
  config: IssuerConfig,
  schemaConfig: CredentialTypeConfig
): Oid4vciIssuerMetadata {
  const vct = resolveVct(schemaConfig.vctPath, config.vctBaseUrl);
  const configId = deriveCredentialConfigurationId(
    schemaConfig.vctPath,
    schemaConfig.name
  );
  const scope = deriveScope(schemaConfig.name);
  const claims = deriveOid4vciClaims(schemaConfig.claims);

  const configuration: CredentialConfigurationSupported = {
    format: "dc+sd-jwt",
    scope,
    vct,
    cryptographic_binding_methods_supported: ["jwk"],
    credential_signing_alg_values_supported: ["ES256", "EdDSA", "ES384"],
    proof_types_supported: {
      jwt: {
        proof_signing_alg_values_supported: ["ES256", "EdDSA", "ES384"],
      },
    },
    display: [
      {
        name: schemaConfig.name,
        locale: "en-US",
        background_color: "#121063",
        text_color: "#FFFFFF",
      },
    ],
    claims,
  };

  const legacySupportedCredential = {
    id: configId,
    format: "vc+sd-jwt",
    scope,
    vct,
    cryptographic_binding_methods_supported: ["jwk"],
    credential_signing_alg_values_supported: ["ES256", "EdDSA", "ES384"],
    proof_types_supported: {
      jwt: {
        proof_signing_alg_values_supported: ["ES256", "EdDSA", "ES384"],
      },
    },
    display: configuration.display,
    claims,
  };

  const modernSupportedCredential = {
    id: `${configId}_v2`,
    format: "dc+sd-jwt",
    scope,
    vct,
    cryptographic_binding_methods_supported: ["jwk"],
    credential_signing_alg_values_supported: ["ES256", "EdDSA", "ES384"],
    proof_types_supported: {
      jwt: {
        proof_signing_alg_values_supported: ["ES256", "EdDSA", "ES384"],
      },
    },
    display: configuration.display,
    claims,
  };

  const credentialConfigurations: Record<
    string,
    CredentialConfigurationSupported
  > = {
    [configId]: configuration,
  };

  const credentialsSupported: Array<Record<string, unknown>> = [
    modernSupportedCredential,
  ];

  if (config.enableLegacyVcFormat) {
    credentialConfigurations[`${configId}_legacy`] = {
      ...configuration,
      format: "vc+sd-jwt" as unknown as "dc+sd-jwt",
    };
    credentialsSupported.unshift(legacySupportedCredential);
  }

  return {
    credential_issuer: config.baseUrl,
    credential_endpoint: `${config.baseUrl}/credential`,
    token_endpoint: `${config.baseUrl}/token`,
    nonce_endpoint: `${config.baseUrl}/nonce`,
    authorization_servers: [config.baseUrl],
    authorization_server: config.baseUrl,
    credential_configurations_supported: credentialConfigurations,
    credentials_supported: credentialsSupported,
  };
}

/**
 * Derives the array of claim metadata entries conforming to draft-ietf-oauth-sd-jwt-vc-19.
 * Recursively maps claims, nested object properties, and array items to claim path pointers.
 *
 * @param claims Record of claim definitions from schema
 * @param parentPath Accumulated path segments
 * @returns Array of SdJwtVcTypeMetadataClaim objects
 */
export function deriveTypeMetadataClaims(
  claims: Record<string, ClaimDef>,
  parentPath: Array<string | number | null> = []
): SdJwtVcTypeMetadataClaim[] {
  const result: SdJwtVcTypeMetadataClaim[] = [];

  for (const [key, def] of Object.entries(claims)) {
    const currentPath = [...parentPath, key];
    const displayName = formatClaimDisplayName(key);

    const display: SdJwtVcTypeClaimDisplay = {
      lang: "en-US",
      locale: "en-US",
      label: displayName,
      name: displayName,
    };
    if (def.description) {
      display.description = def.description;
    }

    const claimEntry: SdJwtVcTypeMetadataClaim = {
      path: currentPath,
      display: [display],
      sd: def.sd === "selectively_disclosable" ? "always" : "never",
      mandatory: def.required ?? false,
    };

    result.push(claimEntry);

    if (def.type === "object" && def.properties) {
      result.push(...deriveTypeMetadataClaims(def.properties, currentPath));
    } else if (def.type === "array" && def.items) {
      if (def.items.type === "object" && def.items.properties) {
        result.push(
          ...deriveTypeMetadataClaims(def.items.properties, [
            ...currentPath,
            null,
          ])
        );
      }
    }
  }

  return result;
}

/**
 * Generates the SD-JWT VC Type Metadata document conforming to
 * draft-ietf-oauth-sd-jwt-vc-19.
 *
 * @param schemaConfig Loaded CredentialTypeConfig
 * @param vctBaseUrl Canonical base URL for resolving vctPath
 * @returns Compliant SdJwtVcTypeMetadata document
 */
export function generateTypeMetadata(
  schemaConfig: CredentialTypeConfig,
  vctBaseUrl: string
): SdJwtVcTypeMetadata {
  return {
    vct: resolveVct(schemaConfig.vctPath, vctBaseUrl),
    name: schemaConfig.name,
    description: schemaConfig.description,
    schema: deriveJsonSchema(schemaConfig),
    display: [
      {
        lang: "en-US",
        locale: "en-US",
        name: schemaConfig.name,
        description: schemaConfig.description,
      },
    ],
    claims: deriveTypeMetadataClaims(schemaConfig.claims),
  };
}
