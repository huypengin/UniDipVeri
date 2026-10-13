import { z } from "zod";
import type { ClaimDef, CredentialTypeConfig } from "./types.js";

export const SdPolicySchema = z.enum(["always_disclosed", "selectively_disclosable"]);

export const ClaimTypeSchema = z.enum(["string", "number", "boolean", "object", "array"]);

export const ClaimDefSchema: z.ZodType<ClaimDef> = z.lazy(() =>
  z
    .object({
      type: ClaimTypeSchema,
      required: z.boolean().optional().default(false),
      sd: SdPolicySchema.optional(),
      description: z.string().optional(),
      format: z.string().optional(),
      properties: z.record(ClaimDefSchema).optional(),
      items: ClaimDefSchema.optional(),
    })
    .strict("Unrecognized semantic feature or directive in claim definition: unknown keys are not supported by the engine.")
    .superRefine((data, ctx) => {
      // Validate object claims
      if (data.type === "object") {
        if (!data.properties || Object.keys(data.properties).length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Object claims must define a non-empty 'properties' object containing child claims.",
            path: ["properties"],
          });
        } else {
          // Every named child property must have an explicit 'sd'
          for (const [key, child] of Object.entries(data.properties)) {
            if (!child.sd) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Child claim "${key}" must explicitly define an 'sd' policy ('always_disclosed' or 'selectively_disclosable').`,
                path: ["properties", key, "sd"],
              });
            }
          }
        }
      }

      // Validate array claims
      if (data.type === "array" && !data.items) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Array claims must define an 'items' schema for child elements.",
          path: ["items"],
        });
      }
    })
);

export const RESERVED_ROOT_CLAIM_NAMES = [
  "iss",
  "vct",
  "iat",
  "nbf",
  "exp",
  "jti",
  "cnf",
  "status",
  "_sd",
  "_sd_alg",
  "...",
] as const;

export type ReservedRootClaimName = (typeof RESERVED_ROOT_CLAIM_NAMES)[number];

export const CredentialTypeConfigSchema: z.ZodType<CredentialTypeConfig> = z
  .object({
    vctPath: z
      .string()
      .min(1, "vctPath cannot be empty")
      .refine((val) => val.startsWith("/"), {
        message: "vctPath must start with '/' (e.g. /types/graduation-record/v1)",
      }),
    name: z.string().min(1, "name cannot be empty"),
    description: z.string().min(1, "description cannot be empty"),
    claims: z.record(ClaimDefSchema).superRefine((claims, ctx) => {
      const keys = Object.keys(claims);
      if (keys.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "claims must contain at least one claim definition",
        });
        return;
      }
      // Every top-level named claim must have an explicit 'sd' and must not collide with reserved names
      for (const [key, claim] of Object.entries(claims)) {
        if ((RESERVED_ROOT_CLAIM_NAMES as readonly string[]).includes(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Claim definition uses reserved top-level claim name "${key}" (RFC 9901 / draft-ietf-oauth-sd-jwt-vc-19).`,
            path: [key],
          });
        }
        if (!claim.sd) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Top-level claim "${key}" must explicitly define an 'sd' policy ('always_disclosed' or 'selectively_disclosable').`,
            path: [key, "sd"],
          });
        }
      }
    }),
  })
  .strict("Unrecognized top-level configuration directive: unknown keys are not supported by the engine.");

export function validateCredentialConfig(raw: unknown): CredentialTypeConfig {
  return CredentialTypeConfigSchema.parse(raw);
}
