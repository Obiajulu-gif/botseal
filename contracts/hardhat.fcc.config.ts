import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";

/**
 * Compiles the FCC `InstructionSender.sol` with the same solc settings as the escrow.
 *
 * The official scaffold path is `fcc/scripts/generate-bindings.sh`, which uses Foundry. This
 * config exists so the contract can also be compiled with the Hardhat toolchain already installed
 * in `contracts/` - useful on machines without Foundry. Both produce the same artifact; the ABI
 * and bytecode are what `abigen` consumes.
 *
 * Usage: npm run compile:fcc
 */
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  paths: {
    // Hardhat refuses to compile sources outside its project root, so the root is raised to the
    // monorepo level for this config only. The FCC contract imports nothing from npm, so no
    // node_modules resolution depends on this.
    root: "..",
    sources: "fcc/contracts",
    cache: "contracts/cache-fcc",
    artifacts: "fcc/artifacts-hardhat",
    tests: "contracts/test-fcc-none",
  },
};

export default config;
