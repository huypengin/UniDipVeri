export type SdPolicy = "always_disclosed" | "selectively_disclosable";

export type ClaimType = "string" | "number" | "boolean" | "object" | "array";

export interface ClaimDef {
  type: ClaimType;
  required?: boolean;
  /**
   * Selective disclosure policy. Required for all named claims (top-level and in properties).
   * Optional for anonymous array item prototypes.
   */
  sd?: SdPolicy;
  description?: string;
  format?: string;
  properties?: Record<string, ClaimDef>;
  items?: ClaimDef;
}

export interface CredentialTypeConfig {
  /** Relative URL path of the credential type (e.g. "/types/graduation-record/v1", must start with '/') */
  vctPath: string;
  name: string;
  description: string;
  claims: Record<string, ClaimDef>;
}
