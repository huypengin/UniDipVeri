import type { IVerificationEngine } from "./types.js";
import { NativeVerificationEngine } from "./native-engine.js";
import { OracleVerificationEngine } from "./oracle-engine.js";

// Types and contracts
export * from "./types.js";

// Token Status List revocation evaluation
export * from "./status-verifier.js";

// Holder Key Binding JWT verification
export * from "./kb-verifier.js";

// Pluggable verification engines
export * from "./native-engine.js";
export * from "./oracle-engine.js";

/**
 * Factory for creating pluggable verification engine instances.
 *
 * @param engineName Name of engine to instantiate ("native" | "oracle", defaults to "native")
 * @returns Instantiated IVerificationEngine
 */
export function createVerificationEngine(
  engineName: "native" | "oracle" = "native"
): IVerificationEngine {
  switch (engineName) {
    case "native":
      return new NativeVerificationEngine();
    case "oracle":
      return new OracleVerificationEngine();
    default:
      throw new Error(`Unsupported verification engine: '${engineName}'`);
  }
}
