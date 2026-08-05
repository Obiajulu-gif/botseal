#!/usr/bin/env node
/**
 * Dependency-free Coston2 connectivity check.
 *
 * Speaks raw JSON-RPC over fetch, so it needs no node_modules, no Hardhat, and no private key. Use
 * it to answer "is the chain reachable and are the addresses real?" before touching the deeper
 * `contracts/scripts/smoke-coston2.ts`, which additionally exercises the deployed escrow.
 *
 * Every value printed is read from the chain. Nothing is asserted that was not actually observed.
 *
 * Usage: node scripts/smoke-coston2.mjs [escrowAddress]
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const RPC_URL = process.env.COSTON2_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
const EXPECTED_CHAIN_ID = 114;

const GREEN = "[32m";
const RED = "[31m";
const DIM = "[2m";
const RESET = "[0m";

let rpcId = 0;
let failures = 0;

async function rpc(method, params = []) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${RPC_URL}`);

  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

/** `eth_call` against a 4-byte selector with no arguments. */
async function call(to, selector) {
  return rpc("eth_call", [{ to, data: selector }, "latest"]);
}

function decodeUint(hex) {
  return BigInt(hex);
}

/** Decodes an ABI-encoded `string` return value. */
function decodeString(hex) {
  const data = hex.slice(2);
  if (data.length < 128) return "";
  const length = Number(BigInt(`0x${data.slice(64, 128)}`));
  const bytes = data.slice(128, 128 + length * 2);
  return Buffer.from(bytes, "hex").toString("utf8");
}

function report(label, value) {
  console.log(`  ${GREEN}ok${RESET}   ${label.padEnd(22)} ${DIM}${value}${RESET}`);
}

function fail(label, error) {
  failures++;
  console.log(`  ${RED}fail${RESET} ${label.padEnd(22)} ${error.message ?? error}`);
}

async function main() {
  console.log(`Coston2 smoke check\n  RPC: ${RPC_URL}\n`);

  // --- Chain identity ---
  console.log("Chain");
  try {
    const chainId = Number(decodeUint(await rpc("eth_chainId")));
    if (chainId !== EXPECTED_CHAIN_ID) {
      throw new Error(`expected chain ${EXPECTED_CHAIN_ID}, got ${chainId}`);
    }
    report("chainId", chainId);
  } catch (error) {
    fail("chainId", error);
    // Nothing below can work without a chain connection.
    console.error("\nCannot reach Coston2. Check the RPC URL and your network.");
    process.exit(1);
  }

  try {
    const block = decodeUint(await rpc("eth_blockNumber"));
    report("latest block", block);
  } catch (error) {
    fail("latest block", error);
  }

  // --- Resolved addresses ---
  const resolvedPath = join(root, "contracts/deployments/coston2-resolved.local.json");
  let resolved;
  if (existsSync(resolvedPath)) {
    resolved = JSON.parse(readFileSync(resolvedPath, "utf8"));
  } else {
    console.log(
      `\n${DIM}No coston2-resolved.local.json — run: cd contracts && npm run resolve:coston2${RESET}`,
    );
  }

  if (resolved?.fxrp) {
    console.log("\nFXRP");
    try {
      const code = await rpc("eth_getCode", [resolved.fxrp, "latest"]);
      if (code === "0x") throw new Error("no bytecode at the resolved address");
      report("address", resolved.fxrp);
      report("bytecode", `${(code.length - 2) / 2} bytes`);

      // symbol() and decimals()
      report("symbol", decodeString(await call(resolved.fxrp, "0x95d89b41")));
      report("decimals", decodeUint(await call(resolved.fxrp, "0x313ce567")));
    } catch (error) {
      fail("FXRP", error);
    }
  }

  if (resolved?.ftsoV2) {
    console.log("\nFTSOv2");
    try {
      const code = await rpc("eth_getCode", [resolved.ftsoV2, "latest"]);
      if (code === "0x") throw new Error("no bytecode at the resolved address");
      report("address", resolved.ftsoV2);
      report("bytecode", `${(code.length - 2) / 2} bytes`);
    } catch (error) {
      fail("FTSOv2", error);
    }
  }

  // --- Escrow, when deployed ---
  const escrow = process.argv[2] ?? process.env.NEXT_PUBLIC_ESCROW_ADDRESS;
  const deploymentPath = join(root, "contracts/deployments/coston2.json");
  const escrowAddress =
    escrow ??
    (existsSync(deploymentPath)
      ? JSON.parse(readFileSync(deploymentPath, "utf8")).escrowAddress
      : undefined);

  if (!escrowAddress) {
    console.log(`\n${DIM}Escrow not deployed yet — skipping escrow checks.${RESET}`);
  } else {
    console.log("\nFlareSealEscrow");
    try {
      const code = await rpc("eth_getCode", [escrowAddress, "latest"]);
      if (code === "0x") throw new Error("no bytecode at the escrow address");
      report("address", escrowAddress);

      // Selectors: nextInvoiceId() 0x6ff2a953, totalEscrowed() 0xf9168231, teeAddress() 0x78b9e620
      report("nextInvoiceId", decodeUint(await call(escrowAddress, "0x6ff2a953")));
      report("totalEscrowed", decodeUint(await call(escrowAddress, "0xf9168231")));
      const tee = await call(escrowAddress, "0x78b9e620");
      const teeAddr = `0x${tee.slice(-40)}`;
      report(
        "teeAddress",
        teeAddr === "0x0000000000000000000000000000000000000000" ? "not configured" : teeAddr,
      );
    } catch (error) {
      fail("escrow", error);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\n${GREEN}All checks passed.${RESET}`);
}

main().catch((error) => {
  console.error(`\nSmoke check aborted: ${error.message}`);
  process.exit(1);
});
