/**
 * Coston2 chain definition and the shared public client.
 *
 * viem ships `flareTestnet` (chain id 114, C2FLR). It is used when the installed viem exports it
 * and matches the configured chain id; otherwise the chain is defined explicitly from the official
 * network constants so a viem upgrade cannot silently repoint the app.
 */

import { defineChain } from "viem";
import { createPublicClient, http, type Chain } from "viem";
import * as chains from "viem/chains";

import { env } from "./env";

export const COSTON2_CHAIN_ID = 114;

const explicitCoston2 = defineChain({
  id: COSTON2_CHAIN_ID,
  name: "Flare Testnet Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://coston2-api.flare.network/ext/C/rpc"] },
  },
  blockExplorers: {
    default: {
      name: "Coston2 Explorer",
      url: "https://coston2-explorer.flare.network",
    },
  },
  testnet: true,
});

function resolveChain(): Chain {
  const fromViem = (chains as Record<string, unknown>).flareTestnet as Chain | undefined;
  const base = fromViem?.id === COSTON2_CHAIN_ID ? fromViem : explicitCoston2;

  // Always honour the configured RPC and explorer so a self-hosted endpoint can be used.
  return {
    ...base,
    id: env.chainId,
    rpcUrls: { default: { http: [env.rpcUrl] } },
    blockExplorers: {
      default: { name: "Coston2 Explorer", url: env.explorerUrl },
    },
  } as Chain;
}

export const coston2: Chain = resolveChain();

/** Read-only client for server components and non-wallet reads. */
export const publicClient = createPublicClient({
  chain: coston2,
  transport: http(env.rpcUrl),
});
