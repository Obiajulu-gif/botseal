/**
 * ★ MAIN CUSTOMIZATION POINT: FlareSeal's confidential invoice handler.
 *
 * INVOICE/CREATE receives an ECIES ciphertext that was encrypted in the browser to this TEE's
 * public key. The handler decrypts it inside the enclave, validates the invoice, computes the
 * total with exact integer arithmetic, derives the terms commitment, and returns ONLY the minimal
 * public result the escrow needs.
 *
 * Privacy contract for this file:
 *   - The decrypted payload never reaches a log, an error message, or the returned result.
 *   - Error strings name a field and a rule; they never echo a submitted value.
 *   - Ciphertext is not logged either; only its length, which is already public on-chain.
 *
 * The framework serializes handler calls, so plain module-level state is safe.
 */

import { NodeClient } from "../base/node.js";
import { hexToBytes } from "../base/encoding.js";
import type { Framework, HandlerResult } from "../base/types.js";

import { encodeInvoiceResult } from "./abi.js";
import {
  OP_COMMAND_CREATE,
  OP_TYPE_INVOICE,
  escrowContractAddress,
  signPort,
} from "./config.js";
import { InvoiceValidationError, validateInvoice } from "./invoice.js";

// --- Extension state ---------------------------------------------------------
// Safe to report publicly: counters and the last action's outcome, never invoice content.
let invoicesProcessed = 0;
let invoicesRejected = 0;
let lastStatus = "";

/** Reset all state. Used by tests; not part of the wire contract. */
export function resetState(): void {
  invoicesProcessed = 0;
  invoicesRejected = 0;
  lastStatus = "";
}

/** Wire handlers to (opType, opCommand) pairs. */
export function register(framework: Framework): void {
  framework.handle(OP_TYPE_INVOICE, OP_COMMAND_CREATE, handleCreateInvoice);
}

/** Snapshot returned by GET /state. */
export function reportState(): unknown {
  return {
    invoicesProcessed,
    invoicesRejected,
    lastStatus,
  };
}

/**
 * Seam for tests: decrypting normally goes through tee-node on the sign port, which is not
 * reachable from a unit test. Tests swap this for an in-process implementation.
 */
export type Decryptor = (ciphertext: Uint8Array) => Promise<Uint8Array>;

let decryptor: Decryptor = (ciphertext) => new NodeClient(signPort()).decrypt(ciphertext);

export function setDecryptor(next: Decryptor): void {
  decryptor = next;
}

export function resetDecryptor(): void {
  decryptor = (ciphertext) => new NodeClient(signPort()).decrypt(ciphertext);
}

/** INVOICE/CREATE — ECIES ciphertext wrapping a JSON PrivateInvoicePayload. */
export async function handleCreateInvoice(msg: string): Promise<HandlerResult> {
  const startedAt = Date.now();

  // 1. Decode the on-chain message into raw ciphertext bytes.
  let ciphertext: Uint8Array;
  try {
    ciphertext = hexToBytes(msg);
  } catch (e) {
    return reject(`decoding request: invalid hex: ${String(e)}`);
  }
  if (ciphertext.length === 0) {
    return reject("decoding request: empty payload");
  }

  // 2. Decrypt inside the TEE.
  let plaintext: Uint8Array;
  try {
    plaintext = await decryptor(ciphertext);
  } catch {
    // Deliberately does not forward the node's error text, which can echo ciphertext bytes.
    return reject("decryption failed");
  }

  // 3. Parse and validate. From here on `payload` is sensitive and must not escape.
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(plaintext).toString("utf-8"));
  } catch {
    return reject("decoding request: payload is not valid JSON");
  }

  const expectedEscrow = escrowContractAddress();
  if (!expectedEscrow) {
    return reject("extension is not configured with ESCROW_CONTRACT_ADDRESS");
  }

  let validated;
  try {
    validated = validateInvoice(payload, {
      expectedEscrow,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
  } catch (e) {
    if (e instanceof InvoiceValidationError) return reject(e.message);
    return reject("validation failed");
  }

  // 4. Respond with the minimal public result.
  const data = encodeInvoiceResult({
    seller: validated.seller,
    buyer: validated.buyer,
    escrowContract: validated.escrowContract,
    usdAmountCents: validated.finalTotalCents,
    dueAt: validated.dueAt,
    termsCommitment: validated.termsCommitment,
  });

  invoicesProcessed++;
  lastStatus = "success";
  logSafely("INVOICE/CREATE succeeded", startedAt);

  return [data, 1, null];
}

function reject(message: string): HandlerResult {
  invoicesRejected++;
  lastStatus = "error";
  return [null, 0, message];
}

/**
 * Emits only non-sensitive facts: what ran, whether it worked, and how long it took. Action ids
 * are attached by the framework, so they are not repeated here.
 */
function logSafely(event: string, startedAt: number): void {
  console.log(
    JSON.stringify({
      event,
      opType: OP_TYPE_INVOICE,
      opCommand: OP_COMMAND_CREATE,
      durationMs: Date.now() - startedAt,
    }),
  );
}
