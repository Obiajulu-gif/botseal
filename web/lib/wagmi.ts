/**
 * Wagmi configuration.
 *
 * The injected connector is used rather than WalletConnect: WalletConnect requires a project id
 * from an external account, and a build that cannot be run without one would be a worse default
 * for a public demo. MetaMask and any other injected BOT Chain wallet work out of the box.
 */

import { createConfig, http } from "wagmi";
// Imported from @wagmi/core rather than the `wagmi/connectors` barrel: that barrel pulls in every
// connector, including Base Account's SDK and its optional @x402/* peers, which are not installed
// and break the production build.
import { injected } from "@wagmi/core";

import { botchain } from "./chain";
import { env } from "./env";

export const wagmiConfig = createConfig({
  chains: [botchain],
  connectors: [injected()],
  transports: {
    [botchain.id]: http(env.rpcUrl),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
