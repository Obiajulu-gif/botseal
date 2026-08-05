import { ethers } from "hardhat";

/**
 * The Flare Contract Registry is deployed at the same address on every Flare network
 * (Flare, Songbird, Coston, Coston2). Source: `@flarenetwork/flare-periphery-contracts`
 * `coston2/ContractRegistry.sol` -> FLARE_CONTRACT_REGISTRY_ADDRESS.
 */
export const FLARE_CONTRACT_REGISTRY_ADDRESS =
  "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";

export const COSTON2_CHAIN_ID = 114n;

export const COSTON2_EXPLORER_BASE_URL =
  process.env.COSTON2_EXPLORER_BASE_URL ?? "https://coston2-explorer.flare.network";

/**
 * Currently documented Coston2 FXRP address. Used only as a warning-level sanity check - the
 * application always resolves FXRP through the FAssets Asset Manager at deployment time.
 * Source: https://dev.flare.network/fxrp/token-interactions/fxrp-address
 */
export const DOCUMENTED_COSTON2_FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7";

const REGISTRY_ABI = [
  "function getContractAddressByName(string _name) view returns (address)",
];

const ASSET_MANAGER_ABI = ["function fAsset() view returns (address)"];

const ERC20_METADATA_ABI = [
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

export type ResolvedFlareAddresses = {
  chainId: string;
  contractRegistry: string;
  assetManagerFXRP: string;
  fxrp: string;
  fxrpSymbol: string;
  fxrpDecimals: number;
  ftsoV2: string;
  matchesDocumentedFxrp: boolean;
  resolvedAt: string;
};

export function txUrl(hash: string): string {
  return `${COSTON2_EXPLORER_BASE_URL}/tx/${hash}`;
}

export function addressUrl(address: string): string {
  return `${COSTON2_EXPLORER_BASE_URL}/address/${address}`;
}

export async function assertCoston2(): Promise<void> {
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== COSTON2_CHAIN_ID) {
    throw new Error(
      `Expected Flare Testnet Coston2 (chainId ${COSTON2_CHAIN_ID}) but connected to ${network.chainId}. ` +
        `Run with --network coston2.`,
    );
  }
}

async function requireCode(address: string, label: string): Promise<void> {
  if (address === ethers.ZeroAddress) {
    throw new Error(`${label} resolved to the zero address.`);
  }
  const code = await ethers.provider.getCode(address);
  if (code === "0x") {
    throw new Error(`${label} at ${address} contains no bytecode.`);
  }
}

/**
 * Resolves FXRP and FTSOv2 live from the Flare Contract Registry.
 *
 * FXRP is never read from a hardcoded constant: the registry yields the FAssets Asset Manager,
 * and `fAsset()` on that manager yields the canonical FXRP token for this network.
 */
export async function resolveFlareAddresses(): Promise<ResolvedFlareAddresses> {
  await assertCoston2();

  const registry = new ethers.Contract(
    FLARE_CONTRACT_REGISTRY_ADDRESS,
    REGISTRY_ABI,
    ethers.provider,
  );
  await requireCode(FLARE_CONTRACT_REGISTRY_ADDRESS, "Flare Contract Registry");

  const assetManagerAddress: string = await registry.getContractAddressByName("AssetManagerFXRP");
  await requireCode(assetManagerAddress, "AssetManagerFXRP");

  const assetManager = new ethers.Contract(
    assetManagerAddress,
    ASSET_MANAGER_ABI,
    ethers.provider,
  );
  const fxrpAddress: string = await assetManager.fAsset();
  await requireCode(fxrpAddress, "FXRP (IAssetManager.fAsset())");

  const ftsoV2Address: string = await registry.getContractAddressByName("FtsoV2");
  await requireCode(ftsoV2Address, "FtsoV2");

  const fxrp = new ethers.Contract(fxrpAddress, ERC20_METADATA_ABI, ethers.provider);
  const [symbol, decimals] = await Promise.all([fxrp.symbol(), fxrp.decimals()]);

  const matchesDocumentedFxrp =
    fxrpAddress.toLowerCase() === DOCUMENTED_COSTON2_FXRP.toLowerCase();

  return {
    chainId: COSTON2_CHAIN_ID.toString(),
    contractRegistry: FLARE_CONTRACT_REGISTRY_ADDRESS,
    assetManagerFXRP: assetManagerAddress,
    fxrp: fxrpAddress,
    fxrpSymbol: symbol,
    fxrpDecimals: Number(decimals),
    ftsoV2: ftsoV2Address,
    matchesDocumentedFxrp,
    resolvedAt: new Date().toISOString(),
  };
}

export { ERC20_METADATA_ABI };
