import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-network-helpers";
import "@typechain/hardhat";
import "solidity-coverage";
import * as dotenv from "dotenv";

dotenv.config();

const BOTCHAIN_RPC_URL = process.env.BOTCHAIN_RPC_URL ?? "https://rpc.botchain.ai";
const BOTCHAIN_TESTNET_RPC_URL =
  process.env.BOTCHAIN_TESTNET_RPC_URL ?? "https://rpc.bohr.life";

// Never fall back to a literal key. An unset key simply means the network has no
// signer configured and deployment scripts will fail loudly instead of silently
// using someone else's account.
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
const accounts = deployerKey && deployerKey.length > 0 ? [deployerKey] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: false,
      // BOT Chain runs the Cancun fork on both networks, so OpenZeppelin v5's `mcopy` is safe.
      // Verified directly rather than assumed: executing `MCOPY` (0x5E) and `TSTORE`/`TLOAD`
      // (0x5C/0x5D) as `eth_call` init code returns the expected values on 677 and 968 alike.
      // See MIGRATION_PLAN.md for the exact probes.
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      // Defaults to the testnet id rather than 31337. The frontend refuses any chain that is not
      // 677 or 968, and the EIP-712 domain binds chainId — so a local node at 31337 cannot host a
      // rehearsal of the confidential flow at all. Overridable for anything that needs otherwise.
      chainId: Number(process.env.HARDHAT_CHAIN_ID ?? 968),
      allowUnlimitedContractSize: false,
    },
    // Deployment target. The Builder Challenge requires mainnet, so this is the network
    // that matters; `botchainTestnet` exists to rehearse against before spending real BOT.
    // The public endpoints are slow — a cold `eth_chainId` was measured at ~12s — and hardhat's
    // default HTTP timeout trips on that intermittently. 60s turns a spurious ConnectTimeoutError
    // during a deploy into a completed transaction.
    botchain: {
      url: BOTCHAIN_RPC_URL,
      chainId: 677,
      accounts,
      timeout: 60_000,
    },
    botchainTestnet: {
      url: BOTCHAIN_TESTNET_RPC_URL,
      chainId: 968,
      accounts,
      timeout: 60_000,
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
