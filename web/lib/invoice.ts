/**
 * Invoice arithmetic and the private payload type.
 *
 * Every monetary value in this module is an integer number of USD cents held as `bigint`. There is
 * no floating-point arithmetic anywhere in this file: `parseUsdToCents` walks the decimal string
 * itself rather than going through `Number`, because `Number("0.07") * 100` is `7.000000000000001`.
 *
 * The browser mirrors the TEE's validation for UX only. The TEE is authoritative — it recomputes
 * every total from the decrypted payload and its result is what the escrow trusts.
 */

import type { Hex } from "viem";

// --- Limits (mirrored from fcc/typescript/src/app/config.ts) -----------------

export const MAX_ITEMS = 20;
export const MIN_ITEMS = 1;
export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_REFERENCE_LENGTH = 80;
export const MAX_QUANTITY = 1_000_000n;
export const MIN_QUANTITY = 1n;
export const MIN_SECRET_LENGTH = 32;
export const MAX_DUE_DATE_HORIZON_SECONDS = 366 * 24 * 60 * 60;
export const MAX_TOTAL_CENTS = 10_000_000_000n;

// --- Types -------------------------------------------------------------------

/**
 * The plaintext invoice, exactly as the TEE expects it. Numeric fields are decimal strings so JSON
 * transport cannot round them.
 *
 * This object is sensitive in full. It is encrypted in the browser and never logged, persisted,
 * placed in a URL, or sent to analytics.
 */
export interface PrivateInvoicePayload {
  version: 1;
  seller: Hex;
  buyer: Hex;
  escrowContract: Hex;
  invoiceReference: string;
  dueAt: number;
  currency: "USD";
  items: Array<{
    description: string;
    quantity: string;
    unitPriceCents: string;
  }>;
  discountCents: string;
  taxCents: string;
  nonce: string;
  salt: string;
}

export interface LineItemInput {
  description: string;
  /** Whole units, as typed. */
  quantity: string;
  /** USD as typed, e.g. "1250.75". */
  unitPriceUsd: string;
}

export interface InvoiceTotals {
  lineTotals: bigint[];
  subtotalCents: bigint;
  discountCents: bigint;
  taxCents: bigint;
  finalTotalCents: bigint;
}

// --- USD <-> cents -----------------------------------------------------------

export class MoneyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyParseError";
  }
}

/**
 * Parses a USD amount written as a decimal string into integer cents.
 *
 * Accepts at most two decimal places — a third would silently lose value on the way to cents, so
 * it is rejected rather than rounded. Digits are handled as text throughout.
 *
 * @example parseUsdToCents("1250.75") === 125075n
 * @example parseUsdToCents("0.07")    === 7n
 */
export function parseUsdToCents(input: string): bigint {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new MoneyParseError("amount is required");

  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    if (/^\d+\.\d{3,}$/.test(trimmed)) {
      throw new MoneyParseError("amount cannot have more than two decimal places");
    }
    throw new MoneyParseError("amount must be a positive number such as 1250.75");
  }

  const [whole = "0", fraction = ""] = trimmed.split(".");
  const cents = fraction.padEnd(2, "0");
  return BigInt(whole) * 100n + BigInt(cents);
}

/** Renders integer cents as a plain USD string. Inverse of {@link parseUsdToCents}. */
export function formatCentsToUsd(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = absolute % 100n;
  return `${negative ? "-" : ""}${whole}.${fraction.toString().padStart(2, "0")}`;
}

/** Renders integer cents as a grouped USD string for display, e.g. `$1,250.75`. */
export function formatCentsAsCurrency(cents: bigint): string {
  const plain = formatCentsToUsd(cents);
  const [whole = "0", fraction = "00"] = plain.replace("-", "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${cents < 0n ? "-" : ""}$${grouped}.${fraction}`;
}

/** Parses a whole-unit quantity string. */
export function parseQuantity(input: string): bigint {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new MoneyParseError("quantity is required");
  if (!/^\d+$/.test(trimmed)) throw new MoneyParseError("quantity must be a whole number");
  if (trimmed.length > 10) throw new MoneyParseError("quantity is too large");

  const quantity = BigInt(trimmed);
  if (quantity < MIN_QUANTITY) throw new MoneyParseError("quantity must be at least 1");
  if (quantity > MAX_QUANTITY) {
    throw new MoneyParseError(`quantity must be at most ${MAX_QUANTITY}`);
  }
  return quantity;
}

// --- Totals ------------------------------------------------------------------

/**
 * Computes line totals, subtotal, and the final total in integer cents.
 *
 * Mirrors the TEE exactly:
 *   lineTotal  = quantity * unitPriceCents
 *   subtotal   = sum(lineTotal)
 *   finalTotal = subtotal - discount + tax
 */
export function computeTotals(
  items: LineItemInput[],
  discountUsd: string,
  taxUsd: string,
): InvoiceTotals {
  const lineTotals: bigint[] = [];
  let subtotalCents = 0n;

  for (const item of items) {
    const quantity = parseQuantity(item.quantity);
    const unitPriceCents = parseUsdToCents(item.unitPriceUsd);
    if (unitPriceCents <= 0n) throw new MoneyParseError("unit price must be greater than zero");

    const lineTotal = quantity * unitPriceCents;
    lineTotals.push(lineTotal);
    subtotalCents += lineTotal;
  }

  const discountCents = discountUsd.trim() === "" ? 0n : parseUsdToCents(discountUsd);
  const taxCents = taxUsd.trim() === "" ? 0n : parseUsdToCents(taxUsd);

  if (discountCents > subtotalCents) {
    throw new MoneyParseError("discount cannot exceed the subtotal");
  }

  const finalTotalCents = subtotalCents - discountCents + taxCents;
  if (finalTotalCents <= 0n) throw new MoneyParseError("invoice total must be greater than zero");
  if (finalTotalCents > MAX_TOTAL_CENTS) {
    throw new MoneyParseError("invoice total exceeds the maximum supported amount");
  }

  return { lineTotals, subtotalCents, discountCents, taxCents, finalTotalCents };
}

// --- Secrets -----------------------------------------------------------------

/**
 * Generates 32 bytes of cryptographically secure randomness as a hex string.
 *
 * Used for the payload `nonce` and `salt`, which make the on-chain terms commitment hiding: without
 * them a short invoice could be brute-forced from its commitment.
 */
export function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// --- Payload assembly --------------------------------------------------------

export interface BuildPayloadInput {
  seller: Hex;
  buyer: Hex;
  escrowContract: Hex;
  invoiceReference: string;
  dueAt: number;
  items: LineItemInput[];
  discountUsd: string;
  taxUsd: string;
}

/**
 * Builds the exact JSON object the TEE validates.
 *
 * The returned value carries the full plaintext invoice plus fresh entropy. Callers encrypt it
 * immediately and drop the reference.
 */
export function buildPrivateInvoicePayload(input: BuildPayloadInput): {
  payload: PrivateInvoicePayload;
  totals: InvoiceTotals;
} {
  const totals = computeTotals(input.items, input.discountUsd, input.taxUsd);

  const payload: PrivateInvoicePayload = {
    version: 1,
    seller: input.seller,
    buyer: input.buyer,
    escrowContract: input.escrowContract,
    invoiceReference: input.invoiceReference.trim(),
    dueAt: input.dueAt,
    currency: "USD",
    items: input.items.map((item) => ({
      description: item.description.trim(),
      quantity: parseQuantity(item.quantity).toString(),
      unitPriceCents: parseUsdToCents(item.unitPriceUsd).toString(),
    })),
    discountCents: totals.discountCents.toString(),
    taxCents: totals.taxCents.toString(),
    nonce: generateSecret(),
    salt: generateSecret(),
  };

  return { payload, totals };
}
