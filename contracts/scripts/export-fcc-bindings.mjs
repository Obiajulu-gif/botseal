/**
 * Extracts the ABI and bytecode that `abigen` needs for the FCC Go bindings.
 *
 * Reads Hardhat artifacts produced by `npm run compile:fcc` and writes the same two files
 * `fcc/scripts/generate-bindings.sh` would produce with Foundry:
 *
 *   fcc/tools/pkg/contracts/flareseal/FlareSealInstructionSender.abi
 *   fcc/tools/pkg/contracts/flareseal/FlareSealInstructionSender.bin
 *   fcc/tools/pkg/contracts/escrow/FlareSealEscrow.abi
 *
 * The escrow needs no .bin: Go only binds to an already-deployed instance, it never deploys one.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const contractsDir = join(here, "..");
const fccDir = join(contractsDir, "..", "fcc");

const TARGETS = [
  {
    label: "FlareSealInstructionSender",
    // Hardhat mirrors the source tree under the artifacts dir, and for this config the project
    // root is the monorepo, so the path keeps its `fcc/contracts/` prefix.
    artifact: join(
      fccDir,
      "artifacts-hardhat",
      "fcc",
      "contracts",
      "InstructionSender.sol",
      "FlareSealInstructionSender.json",
    ),
    outDir: join(fccDir, "tools", "pkg", "contracts", "flareseal"),
    withBytecode: true,
  },
  {
    label: "FlareSealEscrow",
    artifact: join(
      contractsDir,
      "artifacts",
      "contracts",
      "FlareSealEscrow.sol",
      "FlareSealEscrow.json",
    ),
    outDir: join(fccDir, "tools", "pkg", "contracts", "escrow"),
    withBytecode: false,
  },
];

let failed = false;

for (const target of TARGETS) {
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(target.artifact, "utf8"));
  } catch {
    console.error(
      `ERROR: missing artifact for ${target.label} at ${target.artifact}\n` +
        `       Run \`npm run compile\` and \`npm run compile:fcc\` first.`,
    );
    failed = true;
    continue;
  }

  mkdirSync(target.outDir, { recursive: true });

  const abiPath = join(target.outDir, `${target.label}.abi`);
  writeFileSync(abiPath, `${JSON.stringify(artifact.abi, null, 2)}\n`, "utf8");
  console.log(`ABI -> ${abiPath}`);

  if (target.withBytecode) {
    const bytecode = String(artifact.bytecode ?? "").replace(/^0x/, "");
    if (bytecode.length === 0) {
      console.error(`ERROR: ${target.label} artifact has empty bytecode.`);
      failed = true;
      continue;
    }
    const binPath = join(target.outDir, `${target.label}.bin`);
    writeFileSync(binPath, `${bytecode}\n`, "utf8");
    console.log(`BIN -> ${binPath}`);
  }
}

if (failed) process.exit(1);

console.log("\nNext: cd fcc/tools && go generate ./pkg/contracts/...");
