/**
 * FCC client helpers: extension info, ECIES encryption, and result normalisation.
 *
 * Wire shapes here are taken from the running scaffold, not guessed:
 *   GET /info                     -> tee-node `types.SignedTeeInfoResponse`
 *   GET /action/result/<actionId> -> tee-node `types.ActionResponse`
 * (see fcc/tools/pkg/fccutils/tee_calls.go and the tee-node `pkg/types` package).
 *
 * The browser reaches both through this app's own `/api/fcc/*` routes so the proxy URL stays
 * server-side.
 */

import type { Hex } from "viem";

// --- /info -------------------------------------------------------------------

/** The subset of `/info` the client needs. The route strips everything else. */
export interface ExtensionInfo {
  /** Uncompressed secp256k1 public key, `0x04 || X || Y`, used as the ECIES recipient. */
  publicKey: Hex;
  /** Address derived from that key — the TEE signer the escrow verifies against. */
  teeAddress: Hex;
  /** Registry extension id reported by the proxy, for display only. */
  extensionId?: string;
  /** Chain id the TEE is bound to, for a mismatch warning. */
  chainId?: number;
}

/**
 * Normalises the `{x, y}` secp256k1 point from `/info` into an uncompressed public key.
 *
 * tee-node reports both coordinates as 32-byte hashes. They are zero-padded to exactly 32 bytes
 * here, because a coordinate with a leading zero byte is often serialised short.
 */
export function publicKeyFromInfo(x: string, y: string): Hex {
  const clean = (value: string, label: string): string => {
    const hex = value.startsWith("0x") ? value.slice(2) : value;
    if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length === 0 || hex.length > 64) {
      throw new Error(`FCC /info returned an invalid public key coordinate "${label}"`);
    }
    return hex.padStart(64, "0").toLowerCase();
  };
  return `0x04${clean(x, "x")}${clean(y, "y")}` as Hex;
}

// --- Result normalisation ----------------------------------------------------

export const FCC_STATUS_ERROR = 0;
export const FCC_STATUS_SUCCESS = 1;
/** tee-node reports 2 while an instruction is still queued. */
export const FCC_STATUS_PENDING = 2;

/**
 * The five values relayed verbatim into `relayConfidentialInvoice`.
 *
 * `data` and `signature` are passed through untouched: the TEE signed
 * `keccak256(keccak256(data) || id || keccak256(submissionTag) || status)`, so re-encoding any
 * field would invalidate the signature.
 */
export interface FccResult {
  actionId: Hex;
  submissionTag: string;
  status: number;
  data: Hex;
  signature: Hex;
  log: string;
}

export type FccResultState =
  | { kind: "pending" }
  | { kind: "success"; result: FccResult }
  | { kind: "error"; message: string; result?: FccResult };

function asHex(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`FCC result field "${field}" is not hex-encoded`);
  }
  return value as Hex;
}

/**
 * Converts a raw `/action/result` body into a terminal or pending state.
 *
 * A missing body means "not ready yet" rather than an error: the proxy returns a non-200 until the
 * TEE has processed the instruction.
 */
export function normaliseFccResponse(body: unknown): FccResultState {
  if (typeof body !== "object" || body === null) {
    return { kind: "pending" };
  }

  const envelope = body as {
    result?: Record<string, unknown>;
    signature?: unknown;
  };
  const raw = envelope.result;
  if (typeof raw !== "object" || raw === null) {
    return { kind: "pending" };
  }

  const status = Number(raw.status);
  if (!Number.isInteger(status)) {
    return { kind: "error", message: "FCC returned a result with no status" };
  }

  if (status === FCC_STATUS_PENDING) {
    return { kind: "pending" };
  }

  const log = typeof raw.log === "string" ? raw.log : "";

  if (status === FCC_STATUS_ERROR) {
    return {
      kind: "error",
      message: log || "The confidential extension rejected this invoice.",
    };
  }

  if (status !== FCC_STATUS_SUCCESS) {
    return { kind: "error", message: `Unexpected FCC result status ${status}.` };
  }

  let result: FccResult;
  try {
    const data = asHex(raw.data, "data");
    if (data.length <= 2) {
      return { kind: "error", message: "FCC reported success but returned no result data." };
    }

    const signature = asHex(envelope.signature, "signature");
    // 65 bytes = 132 hex characters plus the 0x prefix.
    if (signature.length !== 132) {
      return {
        kind: "error",
        message: "FCC returned a malformed TEE signature (expected 65 bytes).",
      };
    }

    result = {
      actionId: asHex(raw.id, "id"),
      submissionTag: typeof raw.submissionTag === "string" ? raw.submissionTag : "",
      status,
      data,
      signature,
      log,
    };
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : "Malformed FCC result.",
    };
  }

  return { kind: "success", result };
}

// --- Encryption --------------------------------------------------------------

/**
 * ECIES-encrypts the private invoice to the TEE public key.
 *
 * Uses `ecies-geth`, the JavaScript port of go-ethereum's ECIES — the same scheme the extension
 * decrypts with (`ECIES_AES128_SHA256` over secp256k1, as used in
 * fcc/tools/pkg/utils/invoice.go). No cryptography is implemented here.
 *
 * The module is imported dynamically so its Node polyfills stay out of the server bundle.
 */
export async function encryptToTee(publicKey: Hex, plaintext: string): Promise<Hex> {
  const { encrypt } = await import("ecies-geth");
  const { Buffer } = await import("buffer");

  const key = Buffer.from(publicKey.slice(2), "hex");
  const message = Buffer.from(plaintext, "utf-8");

  const ciphertext = await encrypt(key, message);
  return `0x${Buffer.from(ciphertext).toString("hex")}` as Hex;
}

// --- Slippage ----------------------------------------------------------------

export const SLIPPAGE_OPTIONS = [
  { label: "0.5%", bps: 50n },
  { label: "1%", bps: 100n },
  { label: "2%", bps: 200n },
] as const;

/**
 * Applies a slippage buffer to a quoted FXRP amount, rounding up.
 *
 *   maxFxrpAmount = ceil(quoted * (10000 + bps) / 10000)
 *
 * Rounding up matters: a truncated ceiling could land a wei below the amount the contract computes
 * moments later and revert with `SlippageExceeded`.
 */
export function applySlippage(quotedAmount: bigint, slippageBps: bigint): bigint {
  if (quotedAmount < 0n) throw new Error("quoted amount cannot be negative");
  if (slippageBps < 0n) throw new Error("slippage cannot be negative");

  const numerator = quotedAmount * (10_000n + slippageBps);
  const quotient = numerator / 10_000n;
  return numerator % 10_000n === 0n ? quotient : quotient + 1n;
}
