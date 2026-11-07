#!/usr/bin/env bun
/**
 * @file scripts/generate-key.ts
 *
 * Helper utility to generate cryptographic JWK keypairs for the UniDipVeri Issuer.
 * Supports signing algorithms ES256 (NIST P-256), EdDSA (Ed25519), and ES384 (NIST P-384).
 *
 * Usage:
 *   bun run keygen
 *   bun run keygen EdDSA
 *   bun run keygen --alg ES384 --kid my-key-2
 *   bun run keygen --json > private-key.json
 *   bun run keygen --env
 *   bun run keygen --out issuer-key.json
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  generateKeyPair,
  SigningAlgorithmSchema,
  type SigningAlgorithm,
} from "../packages/core/src/signing/signer.js";

interface CliOptions {
  algorithm: SigningAlgorithm;
  kid: string;
  outFile?: string;
  jsonOnly: boolean;
  envOnly: boolean;
  help: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    algorithm: "ES256",
    kid: "key-1",
    jsonOnly: false,
    envOnly: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--json") {
      options.jsonOnly = true;
    } else if (arg === "--env") {
      options.envOnly = true;
    } else if (arg === "--alg" || arg === "-a") {
      const next = args[++i];
      if (!next) throw new Error("Missing value for --alg argument");
      options.algorithm = SigningAlgorithmSchema.parse(next);
    } else if (arg === "--kid" || arg === "-k") {
      const next = args[++i];
      if (!next) throw new Error("Missing value for --kid argument");
      options.kid = next;
    } else if (arg === "--out" || arg === "-o") {
      const next = args[++i];
      if (!next) throw new Error("Missing value for --out argument");
      options.outFile = next;
    } else if (!arg.startsWith("-")) {
      // Positional argument for algorithm
      options.algorithm = SigningAlgorithmSchema.parse(arg);
    } else {
      throw new Error(`Unknown argument: ${arg}. Use --help for usage information.`);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
UniDipVeri Cryptographic Key Generator

Generates exportable JWK keypairs for the UniDipVeri Issuer and formats them
for use with the ISSUER_PRIVATE_KEY_JWK environment variable.

USAGE:
  bun run keygen [ALGORITHM] [OPTIONS]
  bun run scripts/generate-key.ts [ALGORITHM] [OPTIONS]

ALGORITHMS:
  ES256    ECDSA with NIST P-256 curve (Default, recommended for general OID4VCI)
  EdDSA    Edwards-curve DSA with Ed25519 (high performance, European SSI)
  ES384    ECDSA with NIST P-384 curve (high security Suite B profile)

OPTIONS:
  -a, --alg <ALGORITHM>   Signing algorithm (ES256, EdDSA, ES384) [default: ES256]
  -k, --kid <KEY_ID>      Key ID to embed in JWKs [default: key-1]
  -o, --out <PATH>        Write compact private JWK JSON to specified file path
      --env               Output only shell export statements for direct evaluation
      --json              Output only raw private JWK JSON string (pipe-friendly)
  -h, --help              Show this help message

EXAMPLES:
  # Generate default ES256 keypair
  bun run keygen

  # Generate EdDSA keypair and save to file
  bun run keygen EdDSA --out issuer-key.json

  # Output export lines to set in current shell
  eval $(bun run keygen --env)

  # Export private JWK to .env file
  echo "ISSUER_PRIVATE_KEY_JWK='$(bun run keygen --json)'" >> apps/issuer/.env
`);
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  let options: CliOptions;

  try {
    options = parseArgs(rawArgs);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (options.help) {
    printHelp();
    return;
  }

  const { algorithm, kid, outFile, jsonOnly, envOnly } = options;

  const keyPair = await generateKeyPair(algorithm);
  keyPair.publicKeyJwk.kid = kid;
  keyPair.privateKeyJwk.kid = kid;

  const compactPrivateJson = JSON.stringify(keyPair.privateKeyJwk);
  const formattedPrivateJson = JSON.stringify(keyPair.privateKeyJwk, null, 2);
  const formattedPublicJson = JSON.stringify(keyPair.publicKeyJwk, null, 2);

  // If file output requested, write private key JSON
  if (outFile) {
    const targetPath = resolve(process.cwd(), outFile);
    writeFileSync(targetPath, formattedPrivateJson + "\n", "utf8");
    if (!jsonOnly && !envOnly) {
      console.log(`Saved private JWK to: ${targetPath}`);
    }
  }

  // Pure JSON mode (for piping / subshell capture)
  if (jsonOnly) {
    process.stdout.write(compactPrivateJson + "\n");
    return;
  }

  // Shell env mode (for eval or .env copy-paste)
  if (envOnly) {
    console.log(`export SIGNING_ALGORITHM="${algorithm}"`);
    console.log(`export KEY_ID="${kid}"`);
    console.log(`export ISSUER_PRIVATE_KEY_JWK='${compactPrivateJson}'`);
    return;
  }

  // Human-readable interactive report
  console.log("==================================================================");
  console.log("  UniDipVeri Cryptographic Key Generator                          ");
  console.log("==================================================================");
  console.log(`\n  Algorithm : ${algorithm}`);
  console.log(`  Key ID    : ${kid}`);
  console.log(`  Curve     : ${(keyPair.publicKeyJwk as { crv?: string }).crv ?? "N/A"}`);

  console.log("\n[Public JWK] (Published in /.well-known/did.json):");
  console.log(formattedPublicJson);

  console.log("\n[Private JWK] (Keep secret! Set as ISSUER_PRIVATE_KEY_JWK):");
  console.log(formattedPrivateJson);

  console.log("\n------------------------------------------------------------------");
  console.log("  Shell / Environment Configuration Snippet                       ");
  console.log("------------------------------------------------------------------");
  console.log(`export SIGNING_ALGORITHM="${algorithm}"`);
  console.log(`export KEY_ID="${kid}"`);
  console.log(`export ISSUER_PRIVATE_KEY_JWK='${compactPrivateJson}'`);
  console.log("------------------------------------------------------------------");
  console.log("\nQuick Usage Tips:");
  console.log("  • To save directly to file: bun run keygen --out issuer-key.json");
  console.log("  • To export into shell:     eval $(bun run keygen --env)");
  console.log("  • To generate EdDSA key:    bun run keygen EdDSA");
  console.log("==================================================================\n");
}

main().catch((err) => {
  console.error("Fatal error generating keypair:", err);
  process.exit(1);
});
