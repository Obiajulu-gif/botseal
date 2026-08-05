import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-network-helpers";
import "@typechain/hardhat";
import "solidity-coverage";
import * as dotenv from "dotenv";

dotenv.config();

const COSTON2_RPC_URL =
  process.env.COSTON2_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";

// Never fall back to a literal key. An unset key simply means the network has no
// signer configured and deployment scripts will fail loudly instead of silently
// using someone else's account.
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
const coston2Accounts = deployerKey && deployerKey.length > 0 ? [deployerKey] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: false,
      // Flare (and Coston2) support all opcodes through the Cancun hard fork. OpenZeppelin v5.6
      // emits `mcopy`, so anything older than Cancun fails to compile.
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      allowUnlimitedContractSize: false,
    },
    coston2: {
      url: COSTON2_RPC_URL,
      chainId: 114,
      accounts: coston2Accounts,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 120000,
  },
};

export default config;
