import { writeFileSync } from "fs";
import { join } from "path";
import { ethers } from "hardhat";
import { addressUrl, resolveFlareAddresses, txUrl } from "./flare";

const DEFAULT_MAX_PRICE_AGE_SECONDS = 600n;
const DEFAULT_REFUND_GRACE_PERIOD_SECONDS = 604_800n;
const CONFIRMATIONS = 2;

function envBigint(name: string, fallback: bigint): bigint {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a non-negative integer, got "${raw}".`);
  }
  return BigInt(raw);
}

async function main() {
  const flare = await resolveFlareAddresses();

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      "No signer configured. Set DEPLOYER_PRIVATE_KEY in contracts/.env before deploying.",
    );
  }
  const deployer = signers[0];

  const owner = process.env.OWNER_ADDRESS?.trim() || deployer.address;
  if (!ethers.isAddress(owner)) {
    throw new Error(`OWNER_ADDRESS is not a valid address: "${owner}"`);
  }

  const maxPriceAge = envBigint("MAX_PRICE_AGE_SECONDS", DEFAULT_MAX_PRICE_AGE_SECONDS);
  const refundGracePeriod = envBigint(
    "REFUND_GRACE_PERIOD_SECONDS",
    DEFAULT_REFUND_GRACE_PERIOD_SECONDS,
  );

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer            :", deployer.address);
  console.log("Deployer balance    :", ethers.formatEther(balance), "C2FLR");
  if (balance === 0n) {
    throw new Error(
      "Deployer has no C2FLR. Fund it at https://faucet.flare.network before deploying.",
    );
  }

  console.log("Owner               :", owner);
  console.log("FXRP                :", flare.fxrp, `(${flare.fxrpSymbol}, ${flare.fxrpDecimals}d)`);
  console.log("FtsoV2              :", flare.ftsoV2);
  console.log("Max price age (s)   :", maxPriceAge.toString());
  console.log("Refund grace (s)    :", refundGracePeriod.toString());

  const factory = await ethers.getContractFactory("FlareSealEscrow", deployer);
  const escrow = await factory.deploy(
    owner,
    flare.fxrp,
    flare.ftsoV2,
    maxPriceAge,
    refundGracePeriod,
  );

  const deploymentTx = escrow.deploymentTransaction();
  if (!deploymentTx) throw new Error("Deployment transaction is missing.");
  console.log("\nDeployment tx       :", deploymentTx.hash, txUrl(deploymentTx.hash));

  await escrow.waitForDeployment();
  await deploymentTx.wait(CONFIRMATIONS);

  const escrowAddress = await escrow.getAddress();
  console.log("Escrow deployed     :", escrowAddress, addressUrl(escrowAddress));

  // Read the immutable configuration back from chain and assert it matches what we asked for.
  const [onChainOwner, onChainFxrp, onChainFtso, onChainMaxAge, onChainGrace, onChainScale] =
    await Promise.all([
      escrow.owner(),
      escrow.FXRP(),
      escrow.FTSO_V2(),
      escrow.maxPriceAge(),
      escrow.refundGracePeriod(),
      escrow.fxrpScale(),
    ]);

  const mismatches: string[] = [];
  if (onChainOwner.toLowerCase() !== owner.toLowerCase()) mismatches.push("owner");
  if (onChainFxrp.toLowerCase() !== flare.fxrp.toLowerCase()) mismatches.push("FXRP");
  if (onChainFtso.toLowerCase() !== flare.ftsoV2.toLowerCase()) mismatches.push("FtsoV2");
  if (onChainMaxAge !== maxPriceAge) mismatches.push("maxPriceAge");
  if (onChainGrace !== refundGracePeriod) mismatches.push("refundGracePeriod");
  if (onChainScale !== 10n ** BigInt(flare.fxrpDecimals)) mismatches.push("fxrpScale");

  if (mismatches.length > 0) {
    throw new Error(`Post-deployment verification failed for: ${mismatches.join(", ")}`);
  }
  console.log("Post-deploy verification: all immutables match");

  const record = {
    network: "coston2",
    chainId: 114,
    escrowAddress,
    fxrpAddress: flare.fxrp,
    ftsoV2Address: flare.ftsoV2,
    assetManagerFXRP: flare.assetManagerFXRP,
    deploymentTx: deploymentTx.hash,
    deployer: deployer.address,
    owner,
    maxPriceAgeSeconds: Number(maxPriceAge),
    refundGracePeriodSeconds: Number(refundGracePeriod),
    deployedAt: new Date().toISOString(),
  };

  const outPath = join(__dirname, "..", "deployments", "coston2.json");
  writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`\nWrote ${outPath}`);
  console.log(
    "\nNext: start the FCC stack, then run `npm run configure-tee:coston2` with " +
      "TEE_SIGNING_ADDRESS set to the address from the FCC proxy /info endpoint.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
