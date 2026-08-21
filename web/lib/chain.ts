/**
 * BOT Chain definitions and the shared public client.
 *
 * viem ships no BOT Chain definition, so both networks are declared explicitly from the official
 * network constants (dev-docs.botchain.ai/docs/Developers/json-rpc-endpoint). The configured RPC
 * and explorer always win, so a self-hosted or third-party endpoint works without a code change.
 */

import { createPublicClient, defineChain, http, type Chain } from "viem";

import { env } from "./env";

export const BOTCHAIN_MAINNET_ID = 677;
export const BOTCHAIN_TESTNET_ID = 968;

export const botchainMainnet = defineChain({
  id: BOTCHAIN_MAINNET_ID,
  name: "BOT Chain",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.botchain.ai"], webSocket: ["wss://ws-rpc.botchain.ai"] },
  },
  blockExplorers: {
    default: { name: "BOTScan", url: "https://scan.botchain.ai" },
  },
});

export const botchainTestnet = defineChain({
  id: BOTCHAIN_TESTNET_ID,
  name: "BOT Chain Testnet",
  nativeCurrency: { name: "BOT", symbol: "tBOT", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.bohr.life"] },
  },
  blockExplorers: {
    default: { name: "BOTScan Testnet", url: "https://scan.bohr.life" },
  },
  testnet: true,
});

/**
 * The chain the app is configured for.
 *
 * Selected by `NEXT_PUBLIC_CHAIN_ID` so a testnet rehearsal build and the mainnet build differ
 * only by environment. An unrecognised id is a configuration error rather than something to guess
 * at — silently defaulting to mainnet is how funds end up on the wrong network.
 */
function resolveChain(): Chain {
  const base =
    env.chainId === BOTCHAIN_TESTNET_ID
      ? botchainTestnet
      : env.chainId === BOTCHAIN_MAINNET_ID
        ? botchainMainnet
        : undefined;

  if (base === undefined) {
    throw new Error(
      `NEXT_PUBLIC_CHAIN_ID=${env.chainId} is not a BOT Chain network. ` +
        `Use ${BOTCHAIN_MAINNET_ID} (mainnet) or ${BOTCHAIN_TESTNET_ID} (testnet).`,
    );
  }

  // Always honour the configured RPC and explorer.
  return {
    ...base,
    rpcUrls: { default: { http: [env.rpcUrl] } },
    blockExplorers: {
      default: { name: base.blockExplorers.default.name, url: env.explorerUrl },
    },
  } as Chain;
}

export const botchain: Chain = resolveChain();

/** Read-only client for server components and non-wallet reads. */
export const publicClient = createPublicClient({
  chain: botchain,
  transport: http(env.rpcUrl),
});
