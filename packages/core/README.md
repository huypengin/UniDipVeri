# @unidipveri/core

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![SD-JWT: RFC 9901](https://img.shields.io/badge/SD--JWT-RFC%209901-green)](https://datatracker.ietf.org/doc/rfc9901/)
[![SD-JWT VC: draft-19](https://img.shields.io/badge/SD--JWT%20VC-draft--19-green)](https://datatracker.ietf.org/doc/draft-ietf-oauth-sd-jwt-vc/)

`@unidipveri/core` is a schema-agnostic TypeScript engine for **issuing** SD-JWT Verifiable Credentials (claim masking, salted disclosures, signing, and `did:web` resolution). It implements **IETF RFC 9901** and **draft-ietf-oauth-sd-jwt-vc-19** and is tested against the behavior described in those documents.

**Scope:** credential issuance, selective disclosure claim masking and reconstruction, algorithm-agnostic signing, and `did:web` key resolution. In accordance with the thesis scope, end-to-end credential verification is performed by independent, off-the-shelf third-party verifiers and standard libraries.

---

## Design Principles

1. **Schema-agnostic**: No credential field names are hardcoded. Any data model declared in YAML, or built programmatically as a `CredentialTypeConfig`, can be transformed and issued.
2. **Follows RFC 9901 for the implemented parts**:
   - Salts come from a CSPRNG with ≥ 128 bits of entropy.
   - Disclosures are Base64URL-encoded JSON arrays: `[salt, claimName, claimValue]` for object properties and `[salt, claimValue]` for array elements.
   - Digests are computed over the US-ASCII bytes of the disclosure string, with no extra canonicalization.
   - `_sd` arrays are sorted lexicographically.
3. **Algorithm agility**: Built on `jose`. Supports `ES256` (ECDSA P-256), `EdDSA` (Ed25519) and `ES384` (ECDSA P-384) without changing the payload transformation.
4. **No hidden global state**: Schemas, keys and configuration are passed in explicitly. The only I/O is `loadSchemaFromFile` (filesystem) and `resolveDidWeb` / `resolveDidVerificationKey` (HTTP).

---

## Modules

```
packages/core/src/
├── schema/
│   ├── types.ts         # CredentialTypeConfig, ClaimDef, SdPolicy
│   ├── validator.ts     # Zod validation of credential configurations
│   ├── loader.ts        # YAML parsing and explicit file loading
│   └── vct.ts           # VCT resolution
├── sd-jwt/
│   ├── salt.ts          # CSPRNG salt generation (>= 128 bits)
│   ├── disclosure.ts    # Disclosure encoding and decoding
│   ├── digest.ts        # sha-256 (default), sha-384, sha-512
│   └── transform.ts     # Recursive masking and reconstruction
├── signing/
│   ├── signer.ts        # Key generation and sign/verify
│   └── vc-issuer.ts     # SD-JWT VC issuance (typ: "dc+sd-jwt")
├── did/
│   └── did-resolver.ts  # did:web resolution and key dereferencing
├── config/
│   └── config.ts        # Deployment configuration parsing
└── index.ts             # Public API
```

---

## Key APIs

### 1. `issueSdJwtVc(rawClaims, schema, options)`

Validates claims against reserved names, masks selectively disclosable properties, adds metadata (`iss`, `vct`, `iat`, `nbf`, `exp`, `cnf`, `status`) and signs the outer JWS.

```typescript
import { issueSdJwtVc, loadSchemaFromFile, generateKeyPair } from "@unidipveri/core";

const schema = await loadSchemaFromFile("./schemas/graduation-record.v1.yaml");
const key = await generateKeyPair("ES256");

const result = await issueSdJwtVc(
  {
    studentId: "STU-2026-0001",
    fullName: "Alex Doe",
    dateOfBirth: "2002-05-15",
    papers: {
      diploma: {
        degreeName: "Bachelor of Science",
        graduationDate: "2026-06-30",
      },
    },
  },
  schema,
  {
    issuer: "did:web:university.edu",
    signingKey: {
      privateKey: key.privateKey,
      alg: "ES256",
      keyId: "key-1",
    },
  }
);

console.log(result.compact);
// <issuer-signed-jwt>~<disclosure-1>~<disclosure-2>~...~
```

### 2. `transformClaims(claimsData, schema, options)`

Recursively applies each claim's `sd` policy (`always_disclosed` or `selectively_disclosable`), replaces hidden claims with digests in `_sd` arrays (or `...` markers for array elements), and returns the disclosures.

```typescript
import { transformClaims } from "@unidipveri/core";

const { maskedPayload, disclosures } = transformClaims(rawClaims, schema);
// maskedPayload: { studentId: "...", _sd: ["<digest-1>", "<digest-2>"] }
// disclosures:   Base64URL strings, each encoding ["<salt>", "<claimName>", <claimValue>]
```

### 3. `reconstructClaims(maskedPayload, disclosures, options)`

Rebuilds the claims tree from a masked payload and the disclosures that were presented, following the RFC 9901 processing rules.

```typescript
import { reconstructClaims } from "@unidipveri/core";

const revealedClaims = reconstructClaims(maskedPayload, presentedDisclosures);
```

### 4. `resolveDidWeb(did)` and `resolveDidVerificationKey(did, kid)`

HTTP client that fetches a `did:web` DID document and dereferences a verification key for signature checks.

```typescript
import { resolveDidWeb, resolveDidVerificationKey } from "@unidipveri/core";

const didDoc = await resolveDidWeb("did:web:university.edu");
const publicKey = await resolveDidVerificationKey("did:web:university.edu", "key-1");
```

---

## Privacy Properties and Limits

- Undisclosed claims are hidden behind salted digests; with ≥ 128-bit salts they cannot be recovered by guessing.
- SD-JWT does **not** provide unlinkability: the issuer signature and digests are identical across presentations of the same credential.
- No predicate or range proofs are available.

---

## Testing

The test suite covers disclosure encoding/decoding and digest computation, nested object and array element masking, claim reconstruction from presented disclosures, signature generation and verification across all supported algorithms (`ES256`, `EdDSA`, `ES384`), schema validation edge cases and rejection of reserved claim names, VCT resolution logic, `did:web` resolution, and a brute-force resistance experiment demonstrating that unsalted claims can be recovered while 128-bit salts resist it.

```bash
bun test
```
