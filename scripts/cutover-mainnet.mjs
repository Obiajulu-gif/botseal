#!/usr/bin/env node
/**
 * Repoints the app at the BOT Chain mainnet deployment.
 *
 *   node scripts/cutover-mainnet.mjs
 *
 * Run this AFTER `npm run deploy:botchain` has written
 * contracts/deployments/botchain-677.json. It rewrites web/.env.production and
 * web/.env.local from that record, so the addresses the frontend serves come from
 * the deployment itself rather than from anyone retyping them.
 *
 * It does not deploy, does not touch keys, and refuses to run if the record is
 * missing or does not describe chain 677.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAINNET_USDT = "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C";

const recordPath = join(root, "contracts", "deployments", "botchain-677.json");
if (!existsSync(recordPath)) {
  console.error(
    `No mainnet deployment record at ${recordPath}.\n` +
      `Run \`cd contracts && npm run deploy:botchain\` first.`,
  );
  process.exit(1);
}

const record = JSON.parse(readFileSync(recordPath, "utf8"));
if (record.chainId !== 677) {
  console.error(`Record is for chain ${record.chainId}, expected 677. Refusing.`);
  process.exit(1);
}

const escrow = record.escrowAddress;
const token = record.settlementToken?.address;

if (!escrow || !token) {
  console.error("Record is missing escrowAddress or settlementToken.address. Refusing.");
  process.exit(1);
}
if (token.toLowerCase() !== MAINNET_USDT.toLowerCase()) {
  console.error(
    `Record settles in ${token}, which is not mainnet USDT (${MAINNET_USDT}).\n` +
      `Refusing to point the production frontend at an unexpected token.`,
  );
  process.exit(1);
}

console.log("mainnet escrow :", escrow);
console.log("settlement     :", token, `(${record.settlementToken.symbol}/${record.settlementToken.decimals}d)`);

const production = `# Production build config for the hosted demo.
#
# Committed deliberately: every value here is public information that is already
# on-chain and in the README. There are no secrets in this file — the attestor
# key is set in the host's secret store, never here.
#
# NEXT_PUBLIC_* values are inlined at build time, so they must be present when
# the host builds. Written by scripts/cutover-mainnet.mjs from
# contracts/deployments/botchain-677.json.

NEXT_PUBLIC_CHAIN_ID=677
NEXT_PUBLIC_RPC_URL=https://rpc.botchain.ai
NEXT_PUBLIC_EXPLORER_URL=https://scan.botchain.ai

NEXT_PUBLIC_ESCROW_ADDRESS=${escrow}

# Real USDT on BOT Chain mainnet: "Tether USD", 6 decimals.
NEXT_PUBLIC_SETTLEMENT_TOKEN_ADDRESS=${token}

NEXT_PUBLIC_ENABLE_PUBLIC_MODE=false
`;
writeFileSync(join(root, "web", ".env.production"), production, "utf8");
console.log("\nwrote web/.env.production  (chain 677)");

// Update the local file in place, preserving the attestor key and anything else in it.
const localPath = join(root, "web", ".env.local");
if (existsSync(localPath)) {
  const updates = {
    NEXT_PUBLIC_CHAIN_ID: "677",
    NEXT_PUBLIC_RPC_URL: "https://rpc.botchain.ai",
    NEXT_PUBLIC_EXPLORER_URL: "https://scan.botchain.ai",
    NEXT_PUBLIC_ESCROW_ADDRESS: escrow,
    NEXT_PUBLIC_SETTLEMENT_TOKEN_ADDRESS: token,
    ATTESTOR_ESCROW_ADDRESS: escrow,
  };
  const seen = new Set();
  const lines = readFileSync(localPath, "utf8").split("\n").map((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) return line;
    const key = t.slice(0, t.indexOf("=")).trim();
    if (key in updates) {
      seen.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(updates)) if (!seen.has(k)) lines.push(`${k}=${v}`);
  writeFileSync(localPath, lines.join("\n"), "utf8");
  console.log("wrote web/.env.local       (attestor key left untouched)");
}

console.log(`
Next:

  1. Point the mainnet escrow at the attestor:
       cd contracts && npm run configure-attestor:botchain

  2. Update the one server-only var on Vercel, so the attestor refuses to sign
     for the old escrow:
       cd web && vercel env rm ATTESTOR_ESCROW_ADDRESS production --yes --scope obiajulugifs-projects
       echo ${escrow} | vercel env add ATTESTOR_ESCROW_ADDRESS production --scope obiajulugifs-projects

  3. Commit and push — Vercel now builds from git automatically:
       git add -A && git commit -m "Cut over to BOT Chain mainnet" && git push

  4. Verify the deployed site agrees with mainnet:
       cd web && VERIFY_CHAIN_ID=677 npm run verify-live
`);
