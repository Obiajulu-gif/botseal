import { ethers } from "hardhat";

/**
 * BOT Chain network constants and settlement-token resolution.
 *
 * There is no contract registry and no oracle on BOT Chain, so nothing here is resolved
 * dynamically: the settlement token is a known address that we verify, rather than discover.
 */

export const BOTCHAIN_MAINNET_CHAIN_ID = 677n;
export const BOTCHAIN_TESTNET_CHAIN_ID = 968n;

/**
 * USDT on BOT Chain mainnet.
 * Verified on-chain 2026-08-19: name "Tether USD", symbol "USDT", 6 decimals.
 * https://scan.botchain.ai/token/0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C
 */
export const BOTCHAIN_MAINNET_USDT = "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C";

const MAINNET_EXPLORER = "https://scan.botchain.ai";
const TESTNET_EXPLORER = "https://scan.bohr.life";

const ERC20_METADATA_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
];

export interface NetworkInfo {
  chainId: bigint;
  isMainnet: boolean;
  name: string;
  explorerBaseUrl: string;
}

export async function networkInfo(): Promise<NetworkInfo> {
  const { chainId } = await ethers.provider.getNetwork();

  if (chainId === BOTCHAIN_MAINNET_CHAIN_ID) {
    return {
      chainId,
      isMainnet: true,
      name: "BOT Chain",
      explorerBaseUrl: process.env.BOTCHAIN_EXPLORER_BASE_URL?.trim() || MAINNET_EXPLORER,
    };
  }
  if (chainId === BOTCHAIN_TESTNET_CHAIN_ID) {
    return {
      chainId,
      isMainnet: false,
      name: "BOT Chain Testnet",
      explorerBaseUrl: process.env.BOTCHAIN_TESTNET_EXPLORER_BASE_URL?.trim() || TESTNET_EXPLORER,
    };
  }

  throw new Error(
    `Connected to chain ${chainId}, which is not a BOT Chain network. ` +
      `Expected ${BOTCHAIN_MAINNET_CHAIN_ID} (mainnet) or ${BOTCHAIN_TESTNET_CHAIN_ID} (testnet). ` +
      `Pass --network botchain or --network botchainTestnet.`,
  );
}

export async function assertBotChain(): Promise<NetworkInfo> {
  return networkInfo();
}

export interface SettlementToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

/**
 * Resolves and verifies the settlement token for the connected network.
 *
 * Mainnet defaults to the known USDT address; testnet has no canonical USDT, so
 * `SETTLEMENT_TOKEN_ADDRESS` is required there (deploy a 6-decimal MockERC20 first).
 *
 * The mainnet USDT address holds an unrelated 18-decimal token on testnet, which is exactly the
 * kind of mistake that silently mis-scales every invoice by 10^12. Every field is therefore read
 * back from chain and checked, and a mainnet token that does not report USDT/6 is refused outright
 * rather than warned about.
 */
export async function resolveSettlementToken(net: NetworkInfo): Promise<SettlementToken> {
  const override = process.env.SETTLEMENT_TOKEN_ADDRESS?.trim();

  let address: string;
  if (override) {
    if (!ethers.isAddress(override)) {
      throw new Error(`SETTLEMENT_TOKEN_ADDRESS is not a valid address: "${override}"`);
    }
    address = ethers.getAddress(override);
  } else if (net.isMainnet) {
    address = ethers.getAddress(BOTCHAIN_MAINNET_USDT);
  } else {
    throw new Error(
      "BOT Chain testnet has no canonical USDT. Deploy a 6-decimal MockERC20 and set " +
        "SETTLEMENT_TOKEN_ADDRESS to it before deploying the escrow. " +
        "Do NOT point testnet at the mainnet USDT address: that address holds an unrelated " +
        "18-decimal token on chain 968.",
    );
  }

  // The wrong-address mistake this exists to stop: on chain 968 the mainnet USDT address holds an
  // unrelated 18-decimal token ("Weslie"/WES), which passes every generic sanity check below and
  // would silently mis-scale every invoice by 10^12. Refuse it by address, on any network that is
  // not mainnet, regardless of how it was supplied.
  if (!net.isMainnet && address.toLowerCase() === BOTCHAIN_MAINNET_USDT.toLowerCase()) {
    throw new Error(
      `${address} is the MAINNET USDT address. On ${net.name} it holds an unrelated 18-decimal ` +
        `token, and deploying against it would mis-scale every invoice by 10^12. Deploy a ` +
        `6-decimal MockERC20 and point SETTLEMENT_TOKEN_ADDRESS at that instead.`,
    );
  }

  const code = await ethers.provider.getCode(address);
  if (code === "0x") {
    throw new Error(`No contract code at ${address} on ${net.name}.`);
  }

  const token = new ethers.Contract(address, ERC20_METADATA_ABI, ethers.provider);
  const [symbol, decimals, name] = await Promise.all([
    token.symbol() as Promise<string>,
    token.decimals() as Promise<bigint>,
    token.name() as Promise<string>,
  ]);

  const decimalsNumber = Number(decimals);

  if (net.isMainnet) {
    // Applies whether the address came from the default or from an override. Supplying an address
    // explicitly is not a reason to trust it less carefully.
    if (symbol !== "USDT" || decimalsNumber !== 6) {
      throw new Error(
        `Settlement token at ${address} reports ${symbol}/${decimalsNumber}d, expected USDT/6d. ` +
          `Refusing to deploy against an unexpected token on mainnet.`,
      );
    }
  } else if (decimalsNumber !== 6) {
    // Not fatal on testnet - but a rehearsal at different decimals is not rehearsing mainnet.
    console.warn(
      `WARNING: settlement token reports ${decimalsNumber} decimals, mainnet USDT uses 6. ` +
        `The amount math will differ from production.`,
    );
  }

  if (decimalsNumber > 18) {
    throw new Error(`Settlement token reports ${decimalsNumber} decimals; the escrow supports ≤18.`);
  }
  if (decimalsNumber < 2) {
    throw new Error(
      `Settlement token reports ${decimalsNumber} decimals. Invoices are denominated in USD ` +
        `cents, so a token with fewer than 2 decimals cannot represent them exactly.`,
    );
  }

  return { address, symbol, name, decimals: decimalsNumber };
}

export function txUrl(hash: string, net: NetworkInfo): string {
  return `${net.explorerBaseUrl.replace(/\/+$/, "")}/tx/${hash}`;
}

export function addressUrl(address: string, net: NetworkInfo): string {
  return `${net.explorerBaseUrl.replace(/\/+$/, "")}/address/${address}`;
}
