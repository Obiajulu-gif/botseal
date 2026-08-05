#!/usr/bin/env node
/**
 * Copies the ABIs the frontend consumes out of the two Hardhat artifact trees.
 *
 *   contracts/artifacts/      -> FlareSealEscrow            (npm run compile)
 *   fcc/artifacts-hardhat/    -> FlareSealInstructionSender (npm run compile:fcc)
 *
 * Only the `abi` array is written. Bytecode and build metadata stay in the artifact trees so the
 * frontend bundle never carries deployment material.
 *
 * Usage: node scripts/sync-abi.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "web", "lib", "abi");

const SOURCES = [
  {
    name: "FlareSealEscrow",
    artifact: join(
      root,
      "contracts/artifacts/contracts/FlareSealEscrow.sol/FlareSealEscrow.json",
    ),
    out: "FlareSealEscrow.json",
    build: "cd contracts && npm run compile",
  },
  {
    name: "FlareSealInstructionSender",
    artifact: join(
      root,
      "fcc/artifacts-hardhat/fcc/contracts/InstructionSender.sol/FlareSealInstructionSender.json",
    ),
    out: "InstructionSender.json",
    build: "cd contracts && npm run compile:fcc",
  },
];

mkdirSync(outDir, { recursive: true });

let missing = 0;

for (const source of SOURCES) {
  if (!existsSync(source.artifact)) {
    console.error(`MISSING ${source.name}: no artifact at ${source.artifact}`);
    console.error(`        build it first: ${source.build}`);
    missing++;
    continue;
  }

  const { abi } = JSON.parse(readFileSync(source.artifact, "utf8"));
  if (!Array.isArray(abi) || abi.length === 0) {
    console.error(`MISSING ${source.name}: artifact contains no ABI entries`);
    missing++;
    continue;
  }

  const target = join(outDir, source.out);
  writeFileSync(target, `${JSON.stringify(abi, null, 2)}\n`, "utf8");
  console.log(`${source.name} -> web/lib/abi/${source.out} (${abi.length} entries)`);
}

if (missing > 0) {
  console.error(`\n${missing} ABI(s) could not be synced.`);
  process.exit(1);
}

console.log("\nABIs in sync.");
