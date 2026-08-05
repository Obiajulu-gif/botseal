/**
 * ★ Configuration: version and operation identifiers.
 *
 * The op-type and op-command strings MUST match the bytes32 constants in
 * contracts/InstructionSender.sol exactly, or actions fall through to
 * "unsupported op type".
 */

export const VERSION = "0.1.0";

export const OP_TYPE_INVOICE = "INVOICE";
export const OP_COMMAND_CREATE = "CREATE";

/** Domain tag mixed into every terms commitment. Changing it invalidates old commitments. */
export const COMMITMENT_DOMAIN = "FLARESEAL_INVOICE_V1";

// --- Validation limits -------------------------------------------------------
// The TEE is authoritative. The browser mirrors these bounds for UX only.

export const MAX_ITEMS = 20;
export const MIN_ITEMS = 1;
export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_REFERENCE_LENGTH = 80;
export const MAX_QUANTITY = 1_000_000n;
export const MIN_QUANTITY = 1n;
export const MIN_SECRET_LENGTH = 32;
export const MAX_DUE_DATE_HORIZON_SECONDS = 366 * 24 * 60 * 60;

/** Default ceiling on an invoice total: $100,000,000.00 expressed in cents. */
const DEFAULT_MAX_TOTAL_CENTS = 10_000_000_000n;

function readBigintEnv(name: string, fallback: bigint): bigint {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return BigInt(raw);
}

export function maxTotalCents(): bigint {
  return readBigintEnv("MAX_INVOICE_TOTAL_CENTS", DEFAULT_MAX_TOTAL_CENTS);
}

/**
 * The escrow contract this extension will issue results for. Results naming any other escrow are
 * rejected, so a result minted for one deployment can never be relayed into another.
 */
export function escrowContractAddress(): string | undefined {
  const raw = process.env.ESCROW_CONTRACT_ADDRESS?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

/** tee-node's crypto endpoint. Set by the container; defaults to the Docker value. */
export function signPort(): number {
  return Number(process.env.SIGN_PORT ?? 7701);
}
