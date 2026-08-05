import { writeFileSync } from "fs";
import { join } from "path";
import {
  DOCUMENTED_COSTON2_FXRP,
  addressUrl,
  resolveFlareAddresses,
} from "./flare";

/**
 * Resolves the live Coston2 addresses FlareSeal depends on and writes a machine-readable result to
 * `deployments/coston2-resolved.local.json` (gitignored - it is a local cache, not a deployment
 * record).
 */
async function main() {
  const resolved = await resolveFlareAddresses();

  console.log("Resolved Flare Coston2 addresses");
  console.log("  Contract Registry :", resolved.contractRegistry);
  console.log("  AssetManagerFXRP  :", resolved.assetManagerFXRP);
  console.log("  FXRP token        :", resolved.fxrp, addressUrl(resolved.fxrp));
  console.log("  FXRP symbol       :", resolved.fxrpSymbol);
  console.log("  FXRP decimals     :", resolved.fxrpDecimals);
  console.log("  FtsoV2            :", resolved.ftsoV2, addressUrl(resolved.ftsoV2));

  if (!resolved.matchesDocumentedFxrp) {
    console.warn(
      `\n  WARNING: resolved FXRP (${resolved.fxrp}) differs from the currently documented ` +
        `Coston2 address (${DOCUMENTED_COSTON2_FXRP}). The registry is authoritative; this is a ` +
        `sanity check only, and the documentation may simply be behind.`,
    );
  } else {
    console.log("  Documented address match: yes");
  }

  const outPath = join(__dirname, "..", "deployments", "coston2-resolved.local.json");
  writeFileSync(outPath, `${JSON.stringify(resolved, null, 2)}\n`, "utf8");
  console.log(`\nWrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
