// Schema module
export * from "./schema/types.js";
export * from "./schema/validator.js";
export * from "./schema/loader.js";
export * from "./schema/vct.js";

// Configuration module
export * from "./config/config.js";

// Cryptographic signing abstraction
export * from "./signing/signer.js";
export * from "./signing/vc-issuer.js";

// SD-JWT primitives
export * from "./sd-jwt/salt.js";
export * from "./sd-jwt/disclosure.js";
export * from "./sd-jwt/digest.js";
export * from "./sd-jwt/transform.js";

// DID Resolution module (W3C did:web)
export * from "./did/did-resolver.js";

// Pluggable verification engine module
export * from "./verification/index.js";
