import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { ethers } from "hardhat";
import { ERC20_METADATA_ABI, addressUrl, resolveFlareAddresses } from "./flare";

const XRP_USD_FEED_ID = "0x015852502f55534400000000000000000000000000";

const FTSO_ABI = [
  "function getFeedByIdInWei(bytes21 _feedId) payable returns (uint256 _value, uint64 _timestamp)",
];

/**
 * Read-only connectivity check against live Coston2. Every line printed is the result of a real
 * RPC call; nothing here fabricates success. Exits non-zero on the first failed check.
 */
async function main() {
  const failures: string[] = [];

  const block = await ethers.provider.getBlock("latest");
  if (!block) throw new Error("Could not read the latest block.");
  console.log("Latest block         :", block.number, `(${new Date(block.timestamp * 1000).toISOString()})`);

  const flare = await resolveFlareAddresses();
  console.log("FXRP                 :", flare.fxrp, addressUrl(flare.fxrp));

  const fxrp = new ethers.Contract(flare.fxrp, ERC20_METADATA_ABI, ethers.provider);
  const [symbol, name, decimals] = await Promise.all([
    fxrp.symbol(),
    fxrp.name(),
    fxrp.decimals(),
  ]);
  console.log("FXRP name / symbol   :", `${name} / ${symbol}`);
  console.log("FXRP decimals        :", Number(decimals));

  const signers = await ethers.getSigners();
  if (signers.length > 0) {
    const account = signers[0].address;
    const [native, tokenBalance] = await Promise.all([
      ethers.provider.getBalance(account),
      fxrp.balanceOf(account),
    ]);
    console.log("Account              :", account);
    console.log("  C2FLR balance      :", ethers.formatEther(native));
    console.log("  FXRP balance       :", ethers.formatUnits(tokenBalance, decimals), symbol);
    if (native === 0n) {
      console.warn("  WARNING: no C2FLR. Fund at https://faucet.flare.network");
    }
  } else {
    console.log("Account              : none configured (DEPLOYER_PRIVATE_KEY unset) - skipping balances");
  }

  // FTSOv2 getFeedByIdInWei is payable, so it must be simulated rather than read as a view.
  // Pin the simulation to a specific block so the reported age compares the feed timestamp
  // against the same block.timestamp the contract would see. Reading `latest` twice can put the
  // call on a newer block than the header we fetched and produce a nonsensical negative age.
  const ftso = new ethers.Contract(flare.ftsoV2, FTSO_ABI, ethers.provider);
  try {
    const [value, timestamp] = await ftso.getFeedByIdInWei.staticCall(XRP_USD_FEED_ID, {
      blockTag: block.number,
    });
    const ageSeconds = BigInt(block.timestamp) - timestamp;
    console.log("XRP/USD (FTSOv2)     :", ethers.formatEther(value), "USD");
    console.log("  Feed timestamp     :", new Date(Number(timestamp) * 1000).toISOString());
    console.log("  Age                :", `${ageSeconds}s`);
    if (value === 0n) failures.push("FTSOv2 returned a zero XRP/USD price");
    if (ageSeconds > 600n) {
      console.warn("  WARNING: feed is older than the default 600s maxPriceAge");
    }
  } catch (error) {
    failures.push(`FTSOv2 XRP/USD simulation failed: ${(error as Error).message}`);
  }

  const deploymentPath = join(__dirname, "..", "deployments", "coston2.json");
  if (existsSync(deploymentPath)) {
    const record = JSON.parse(readFileSync(deploymentPath, "utf8"));
    const escrow = await ethers.getContractAt("FlareSealEscrow", record.escrowAddress);
    const [owner, escrowFxrp, escrowFtso, maxAge, grace, teeAddress, nextId, escrowed] =
      await Promise.all([
        escrow.owner(),
        escrow.FXRP(),
        escrow.FTSO_V2(),
        escrow.maxPriceAge(),
        escrow.refundGracePeriod(),
        escrow.teeAddress(),
        escrow.nextInvoiceId(),
        escrow.totalEscrowed(),
      ]);

    console.log("\nEscrow               :", record.escrowAddress, addressUrl(record.escrowAddress));
    console.log("  Owner              :", owner);
    console.log("  FXRP               :", escrowFxrp);
    console.log("  FtsoV2             :", escrowFtso);
    console.log("  Max price age      :", `${maxAge}s`);
    console.log("  Refund grace       :", `${grace}s`);
    console.log("  TEE address        :", teeAddress);
    console.log("  Next invoice id    :", nextId.toString());
    console.log("  Total escrowed     :", ethers.formatUnits(escrowed, decimals), symbol);

    if (escrowFxrp.toLowerCase() !== flare.fxrp.toLowerCase()) {
      failures.push("Deployed escrow points at a different FXRP than the registry resolves");
    }
    if (escrowFtso.toLowerCase() !== flare.ftsoV2.toLowerCase()) {
      failures.push("Deployed escrow points at a different FtsoV2 than the registry resolves");
    }
    if (teeAddress === ethers.ZeroAddress) {
      console.warn("  WARNING: TEE address is unset - confidential relay will revert.");
    }
  } else {
    console.log("\nEscrow               : not deployed (deployments/coston2.json missing)");
  }

  if (failures.length > 0) {
    console.error("\nSMOKE CHECK FAILED:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nAll smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
