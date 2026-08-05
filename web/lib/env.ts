/**
 * Environment validation.
 *
 * Public (`NEXT_PUBLIC_*`) values are inlined into the browser bundle at build time, so they are
 * read through an explicit literal map — `process.env[someVariable]` is not statically analysable
 * and would come back undefined in the client.
 *
 * Server-only values live in {@link serverEnv} and are read lazily inside route handlers, so an
 * unset `FCC_PROXY_URL` never breaks a page render.
 */

import { z } from "zod";

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte address");

/** An address that may be blank before deployment; blank normalises to `undefined`. */
const optionalAddress = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? undefined : value))
  .pipe(addressSchema.optional());

const booleanish = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase() === "true");

const positiveInt = (fallback: number) =>
  z
    .string()
    .trim()
    .transform((value) => (value.length === 0 ? fallback : Number(value)))
    .pipe(z.number().int().positive());

const publicSchema = z.object({
  chainId: z
    .string()
    .trim()
    .transform((value) => (value.length === 0 ? 114 : Number(value)))
    .pipe(z.number().int().positive()),
  rpcUrl: z.string().url(),
  explorerUrl: z.string().url(),
  escrowAddress: optionalAddress,
  instructionSenderAddress: optionalAddress,
  fxrpAddress: optionalAddress,
  enablePublicMode: booleanish,
  fccPollIntervalMs: positiveInt(2500),
  fccResultTimeoutMs: positiveInt(180000),
});

export type PublicEnv = z.infer<typeof publicSchema>;

const DEFAULT_RPC_URL = "https://coston2-api.flare.network/ext/C/rpc";
const DEFAULT_EXPLORER_URL = "https://coston2-explorer.flare.network";

function readPublicEnv(): PublicEnv {
  const parsed = publicSchema.safeParse({
    chainId: process.env.NEXT_PUBLIC_CHAIN_ID ?? "",
    rpcUrl: process.env.NEXT_PUBLIC_COSTON2_RPC_URL || DEFAULT_RPC_URL,
    explorerUrl: process.env.NEXT_PUBLIC_COSTON2_EXPLORER_URL || DEFAULT_EXPLORER_URL,
    escrowAddress: process.env.NEXT_PUBLIC_ESCROW_ADDRESS ?? "",
    instructionSenderAddress: process.env.NEXT_PUBLIC_INSTRUCTION_SENDER_ADDRESS ?? "",
    fxrpAddress: process.env.NEXT_PUBLIC_FXRP_ADDRESS ?? "",
    enablePublicMode: process.env.NEXT_PUBLIC_ENABLE_PUBLIC_MODE ?? "false",
    fccPollIntervalMs: process.env.NEXT_PUBLIC_FCC_POLL_INTERVAL_MS ?? "",
    fccResultTimeoutMs: process.env.NEXT_PUBLIC_FCC_RESULT_TIMEOUT_MS ?? "",
  });

  if (!parsed.success) {
    // Malformed public config is a build-time mistake, not a runtime condition to recover from.
    const detail = parsed.error.issues
      .map((issue) => `  NEXT_PUBLIC_${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid FlareSeal public environment:\n${detail}`);
  }

  return parsed.data;
}

export const env: PublicEnv = readPublicEnv();

/** True once the escrow address is configured; pages gate their write actions on this. */
export const isEscrowConfigured = env.escrowAddress !== undefined;

/** True once the FCC InstructionSender is configured. */
export const isInstructionSenderConfigured = env.instructionSenderAddress !== undefined;

/**
 * The native-token fee forwarded with `sendCreateInvoice`, in wei.
 *
 * The value is not invented here: the operator copies it from the fee the scaffold's own
 * deployment/test path uses against the live registry (see docs/FCC_FLOW.md). Unset means zero,
 * which is correct for the current Coston2 registry. It must be public because the browser wallet
 * — not the server — sends the instruction transaction.
 */
export function instructionFeeWei(): bigint {
  const raw = process.env.NEXT_PUBLIC_FCC_INSTRUCTION_FEE_WEI?.trim();
  if (!raw) return 0n;
  if (!/^\d+$/.test(raw)) {
    throw new Error("NEXT_PUBLIC_FCC_INSTRUCTION_FEE_WEI must be an integer number of wei");
  }
  return BigInt(raw);
}

// --- Server-only ------------------------------------------------------------

/**
 * Reads the FCC proxy URL. Server-side only — the browser talks to `/api/fcc/*`, never to the
 * proxy directly, so the tunnel URL is never disclosed to a page visitor.
 */
export function fccProxyUrl(): string {
  const raw = process.env.FCC_PROXY_URL?.trim();
  if (!raw) {
    throw new Error("FCC_PROXY_URL is not set. Point it at the running FCC extension proxy.");
  }
  return raw.replace(/\/+$/, "");
}
