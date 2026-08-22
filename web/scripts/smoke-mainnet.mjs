#!/usr/bin/env node
/**
 * Proves the confidential path against the LIVE production attestor and the mainnet escrow.
 *
 *   node scripts/smoke-mainnet.mjs
 *
 * This is the one check that exercises everything at once, in production: the deployed site's
 * attestor decrypts a real ECIES payload, recomputes the total, signs EIP-712 bound to chain 677
 * and the mainnet escrow, and the escrow accepts the relay.
 *
 * It runs from web/ because that is where ecies-geth lives, and it needs the seller key to send
 * the relay. Funding and release run only if the buyer already holds USDT; real USDT cannot be
 * minted, so with an empty buyer the script reports the loop as unfunded rather than failing.
 *
 * Env:
 *   SITE            default https://botseal.vercel.app
 *   RPC             default https://rpc.botchain.ai
 *   SELLER_KEY      required - reads contracts/.env DEPLOYER_PRIVATE_KEY if unset
 *   BUYER_ADDRESS   required - must differ from the seller
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, defineChain, encodeFunctionData,
         keccak256, toHex, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encrypt } from "ecies-geth";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SITE = (process.env.SITE ?? "https://botseal.vercel.app").replace(/\/+$/, "");
const RPC = process.env.RPC ?? "https://rpc.botchain.ai";

const checks = [];
const check = (label, ok, detail = "") => {
  checks.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
};

function envValue(path, key) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#") || !s.includes("=")) continue;
    const [k, ...rest] = s.split("=");
    if (k.trim() === key) return rest.join("=").trim();
  }
  return undefined;
}

const botchain = defineChain({
  id: 677,
  name: "BOT Chain",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: "BOTScan", url: "https://scan.botchain.ai" } },
});

const ESCROW_ABI = [
  { type: "function", name: "attestorAddress", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "nextInvoiceId", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "quoteInvoice", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "getInvoice", inputs: [{ type: "uint256" }],
    outputs: [{ type: "tuple", components: [
      { name: "id", type: "uint256" }, { name: "seller", type: "address" },
      { name: "buyer", type: "address" }, { name: "termsCommitment", type: "bytes32" },
      { name: "attestationId", type: "bytes32" }, { name: "usdAmountCents", type: "uint256" },
      { name: "tokenAmount", type: "uint256" }, { name: "dueAt", type: "uint64" },
      { name: "createdAt", type: "uint64" }, { name: "fundedAt", type: "uint64" },
      { name: "settledAt", type: "uint64" }, { name: "confidential", type: "bool" },
      { name: "status", type: "uint8" }] }],
    stateMutability: "view" },
  { type: "function", name: "relayConfidentialInvoice",
    inputs: [
      { name: "attestation", type: "tuple", components: [
        { name: "seller", type: "address" }, { name: "buyer", type: "address" },
        { name: "usdAmountCents", type: "uint256" }, { name: "dueAt", type: "uint64" },
        { name: "termsCommitment", type: "bytes32" }, { name: "attestationId", type: "bytes32" }] },
      { name: "signature", type: "bytes" }],
    outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
];

async function main() {
  const sellerKey = process.env.SELLER_KEY
    ?? envValue(join(root, "contracts", ".env"), "DEPLOYER_PRIVATE_KEY");
  if (!sellerKey) throw new Error("No seller key. Set SELLER_KEY or DEPLOYER_PRIVATE_KEY.");

  const seller = privateKeyToAccount(sellerKey.startsWith("0x") ? sellerKey : `0x${sellerKey}`);

  console.log("Live attestor");
  const info = await (await fetch(`${SITE}/api/attestor/info`)).json();
  check("site reachable", true, SITE);
  check("reports mainnet", info.chainId === 677, `chain ${info.chainId}`);

  const escrowAddress = getAddress(info.escrowContract);
  const buyer = getAddress(process.env.BUYER_ADDRESS ?? info.attestorAddress);
  check("buyer differs from seller", buyer.toLowerCase() !== seller.address.toLowerCase(), buyer);

  const pub = createPublicClient({ chain: botchain, transport: http(RPC) });
  const wallet = createWalletClient({ account: seller, chain: botchain, transport: http(RPC) });

  const onChainAttestor = await pub.readContract({
    address: escrowAddress, abi: ESCROW_ABI, functionName: "attestorAddress" });
  check("site attestor == chain attestor",
    onChainAttestor.toLowerCase() === info.attestorAddress.toLowerCase(), onChainAttestor);

  // --- encrypt a real invoice to the live service -------------------------------
  console.log("\nConfidential relay (production attestor)");
  const dueAt = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  const payload = {
    version: 1,
    seller: seller.address,
    buyer,
    escrowContract: escrowAddress,
    invoiceReference: "BOTSEAL-MAINNET-001",
    dueAt,
    currency: "USD",
    // 1 x 1 cent = $0.01, so the loop can be completed with a trivial amount of real USDT.
    items: [{ description: "Mainnet verification line item", quantity: "1", unitPriceCents: "1" }],
    discountCents: "0",
    taxCents: "0",
    nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
    salt: toHex(crypto.getRandomValues(new Uint8Array(32))),
  };

  const cipher = await encrypt(
    Buffer.from(info.publicKey.slice(2), "hex"),
    Buffer.from(JSON.stringify(payload), "utf-8"),
  );
  const res = await fetch(`${SITE}/api/attestor/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ciphertext: `0x${Buffer.from(cipher).toString("hex")}` }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`attestor refused: ${body.error} — ${body.message}`);
  check("attestor signed", true, `total ${body.attestation.usdAmountCents} cents`);
  check("total recomputed, not trusted", body.attestation.usdAmountCents === "1");

  const attestation = {
    seller: getAddress(body.attestation.seller),
    buyer: getAddress(body.attestation.buyer),
    usdAmountCents: BigInt(body.attestation.usdAmountCents),
    dueAt: BigInt(body.attestation.dueAt),
    termsCommitment: body.attestation.termsCommitment,
    attestationId: body.attestation.attestationId,
  };

  const expectedId = await pub.readContract({
    address: escrowAddress, abi: ESCROW_ABI, functionName: "nextInvoiceId" });

  const hash = await wallet.writeContract({
    address: escrowAddress, abi: ESCROW_ABI,
    functionName: "relayConfidentialInvoice", args: [attestation, body.signature],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  check("relay mined on mainnet", receipt.status === "success",
    `https://scan.botchain.ai/tx/${hash}`);

  // --- the privacy claim, checked against real mainnet calldata -----------------
  const tx = await pub.getTransaction({ hash });
  const calldata = tx.input.toLowerCase();
  const secrets = ["Mainnet verification line item", "BOTSEAL-MAINNET-001"];
  const leaked = secrets.filter((s) =>
    calldata.includes(Buffer.from(s, "utf8").toString("hex").toLowerCase()));
  check("no plaintext in mainnet calldata", leaked.length === 0,
    `${(calldata.length - 2) / 2} bytes`);

  const invoice = await pub.readContract({
    address: escrowAddress, abi: ESCROW_ABI, functionName: "getInvoice", args: [expectedId] });
  check("stored confidential", invoice.confidential === true, `invoice #${expectedId}`);
  check("total stored exactly", invoice.usdAmountCents === 1n, "$0.01");

  const due = await pub.readContract({
    address: escrowAddress, abi: ESCROW_ABI, functionName: "quoteInvoice", args: [expectedId] });
  check("quote exact", due === 10_000n, `${Number(due) / 1e6} USDT`);

  const failed = checks.filter((c) => !c).length;
  console.log(
    failed === 0
      ? `\nALL ${checks.length} CHECKS PASSED — the confidential path works on BOT Chain mainnet.`
      : `\n${failed} of ${checks.length} FAILED.`,
  );
  console.log(`\nInvoice #${expectedId} is live and awaiting funding.`);
  console.log(`Buyer ${buyer} needs ${Number(due) / 1e6} USDT and a little BOT to complete it.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("\nSMOKE FAILED:", e?.shortMessage ?? e?.message ?? e);
  process.exitCode = 1;
});
