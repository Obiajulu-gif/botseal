import { readFileSync } from "fs";
import { join } from "path";
import { ethers } from "hardhat";
import { assertCoston2, txUrl } from "./flare";

/**
 * Points the deployed escrow at the FCC TEE signing address.
 *
 * The address is taken from `TEE_SIGNING_ADDRESS`, or discovered from the FCC proxy `/info`
 * endpoint when `FCC_PROXY_URL` is set. It must be the *TEE signing* address - never the proxy
 * wallet, the extension owner, or the deployer.
 */

/**
 * Shape of the FCC proxy `/info` response.
 *
 * Source of truth: `flare-foundation/tee-node`, `pkg/types/tee.go` -
 *   SignedTeeInfoResponse { teeInfo, machineData, dataSignature, attestation, proxySignature }
 *   TeeInfo               { challenge, publicKey, chainId, ... }
 *   PublicKey             { x: hash, y: hash }
 *
 * There is no field that carries the signing address directly. The TEE signing address is the
 * Ethereum address derived from `teeInfo.publicKey`, exactly as tee-node's tooling does it
 * (`crypto.PubkeyToAddress(pubKey)`).
 */
type InfoResponse = {
  teeInfo?: { publicKey?: { x?: string; y?: string } };
};

function normalise32(value: string, label: string): string {
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error(`TEE public key ${label} is not hex: "${value}"`);
  }
  if (hex.length > 64) {
    throw new Error(`TEE public key ${label} is longer than 32 bytes: "${value}"`);
  }
  return hex.padStart(64, "0");
}

/** Derives the TEE signing address from the secp256k1 point in `/info`. */
export function teeAddressFromInfo(info: InfoResponse): string {
  const key = info.teeInfo?.publicKey;
  if (!key || typeof key.x !== "string" || typeof key.y !== "string") {
    throw new Error(
      "FCC proxy /info did not contain teeInfo.publicKey {x, y}. " +
        "Set TEE_SIGNING_ADDRESS explicitly instead.",
    );
  }

  const uncompressed = `0x04${normalise32(key.x, "x")}${normalise32(key.y, "y")}`;
  return ethers.computeAddress(uncompressed);
}

async function discoverFromProxy(proxyUrl: string): Promise<string> {
  const url = `${proxyUrl.replace(/\/$/, "")}/info`;
  console.log("Querying FCC proxy   :", url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`FCC proxy /info returned HTTP ${response.status}`);
    }
    const info = (await response.json()) as InfoResponse;
    const address = teeAddressFromInfo(info);
    console.log("Derived TEE address  :", address, "(from teeInfo.publicKey)");
    return address;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  await assertCoston2();

  const deploymentPath = join(__dirname, "..", "deployments", "coston2.json");
  let escrowAddress: string;
  try {
    escrowAddress = JSON.parse(readFileSync(deploymentPath, "utf8")).escrowAddress;
  } catch {
    throw new Error(
      `Could not read ${deploymentPath}. Deploy the escrow first with \`npm run deploy:coston2\`.`,
    );
  }

  let teeAddress = process.env.TEE_SIGNING_ADDRESS?.trim();
  if (!teeAddress) {
    const proxyUrl = process.env.FCC_PROXY_URL?.trim();
    if (!proxyUrl) {
      throw new Error(
        "Set TEE_SIGNING_ADDRESS to the address reported by the FCC proxy /info endpoint, " +
          "or set FCC_PROXY_URL so this script can read it.",
      );
    }
    teeAddress = await discoverFromProxy(proxyUrl);
  }

  if (!ethers.isAddress(teeAddress)) {
    throw new Error(`"${teeAddress}" is not a valid address.`);
  }

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("No signer configured. Set DEPLOYER_PRIVATE_KEY in contracts/.env.");
  }
  const sender = signers[0];

  const escrow = await ethers.getContractAt("FlareSealEscrow", escrowAddress, sender);

  const owner = await escrow.owner();
  if (owner.toLowerCase() !== sender.address.toLowerCase()) {
    throw new Error(
      `setTeeAddress is owner-only. Escrow owner is ${owner} but the configured signer is ` +
        `${sender.address}.`,
    );
  }

  const previous = await escrow.teeAddress();
  console.log("Escrow               :", escrowAddress);
  console.log("Current TEE address  :", previous);
  console.log("New TEE address      :", teeAddress);

  if (previous.toLowerCase() === teeAddress.toLowerCase()) {
    console.log("Already configured. Nothing to do.");
    return;
  }

  const tx = await escrow.setTeeAddress(teeAddress);
  console.log("Configuration tx     :", tx.hash, txUrl(tx.hash));
  await tx.wait(2);

  const readBack = await escrow.teeAddress();
  if (readBack.toLowerCase() !== teeAddress.toLowerCase()) {
    throw new Error(`Read-back mismatch: expected ${teeAddress}, got ${readBack}`);
  }
  console.log("Read back            :", readBack);
  console.log("\nRecord this transaction hash in BUILD_REPORT.md.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
