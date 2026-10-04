import { z } from "zod";
import { SigningAlgorithmSchema } from "../signing/signer.js";

export const DeploymentConfigSchema = z.object({
  /**
   * Explicit path to the credential schema artifact (e.g. /path/to/graduation-record.yaml).
   * Injected via environment or application args.
   */
  schemaPath: z.string().min(1, "schemaPath is required and cannot be empty"),

  /**
   * Cryptographic algorithm for credential signing. Defaults to ES256.
   */
  signingAlgorithm: SigningAlgorithmSchema.default("ES256"),

  /**
   * Key identifier referencing the issuer's verification method in its DID document.
   */
  keyId: z.string().default("key-1"),

  /**
   * The issuer's DID identifier (e.g., did:web:university.example.edu).
   */
  issuerDid: z.string().startsWith("did:", "issuerDid must be a valid DID URI starting with 'did:'"),
});

export type DeploymentConfig = z.infer<typeof DeploymentConfigSchema>;

/**
 * Loads deployment configuration from process.env or an explicit dictionary.
 */
export function loadConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): DeploymentConfig {
  return DeploymentConfigSchema.parse({
    schemaPath: env.SCHEMA_PATH,
    signingAlgorithm: env.SIGNING_ALGORITHM || "ES256",
    keyId: env.KEY_ID || "key-1",
    issuerDid: env.ISSUER_DID || "did:web:example.university.edu",
  });
}
