/**
 * POST /api/attestor/create
 *
 * The confidential path, end to end: accept an ECIES ciphertext, decrypt it, recompute every
 * total from the plaintext, and sign only the settlement facts.
 *
 * What crosses back to the browser is the six attested fields and a signature. The plaintext is
 * never logged, never persisted, and never echoed — validation errors name the field and the rule
 * that failed, never the value.
 *
 * This route replaces the on-chain instruction round-trip the previous build used. The seller no
 * longer pays for an instruction transaction and then polls for a result: they call this once and
 * relay the signature themselves, which is one fewer transaction and one fewer failure mode.
 */

import { NextResponse } from "next/server";
import type { Hex } from "viem";

import {
  serialiseAttestation,
  type AttestorCreateResponse,
  type ConfidentialAttestation,
} from "@/lib/attestor";
import {
  configuredEscrow,
  decryptToText,
  signAttestation,
} from "@/lib/attestor/signer";
import {
  InvoiceValidationError,
  deriveAttestationId,
  validateInvoice,
} from "@/lib/attestor/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" };

/** 256 KB of hex is far beyond a 20-item invoice and bounds the work an anonymous caller can cause. */
const MAX_CIPHERTEXT_CHARS = 256 * 1024;

function reject(
  status: number,
  error: string,
  message: string,
): NextResponse<AttestorCreateResponse> {
  return NextResponse.json({ ok: false, error, message }, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  // --- Parse the envelope ---------------------------------------------------
  let ciphertext: Hex;
  try {
    const body = (await request.json()) as { ciphertext?: unknown };
    if (typeof body?.ciphertext !== "string" || !/^0x[0-9a-fA-F]+$/.test(body.ciphertext)) {
      return reject(400, "invalid-request", "`ciphertext` must be a 0x-prefixed hex string.");
    }
    if (body.ciphertext.length > MAX_CIPHERTEXT_CHARS) {
      return reject(413, "payload-too-large", "The encrypted payload is too large.");
    }
    ciphertext = body.ciphertext as Hex;
  } catch {
    return reject(400, "invalid-request", "Request body must be JSON.");
  }

  // --- Configuration --------------------------------------------------------
  let escrowContract: Hex;
  try {
    escrowContract = configuredEscrow();
  } catch (error) {
    return reject(
      503,
      "attestor-unavailable",
      error instanceof Error ? error.message : "The attestor is not configured.",
    );
  }

  // --- Decrypt --------------------------------------------------------------
  let plaintext: string;
  try {
    plaintext = await decryptToText(ciphertext);
  } catch (error) {
    if (error instanceof Error && error.message.includes("ATTESTOR_PRIVATE_KEY")) {
      return reject(503, "attestor-unavailable", error.message);
    }
    // Deliberately uniform: distinguishing "wrong key" from "malformed ciphertext" is an oracle.
    return reject(400, "decryption-failed", "The payload could not be decrypted.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return reject(400, "invalid-payload", "The decrypted payload is not valid JSON.");
  }

  // --- Validate and recompute ----------------------------------------------
  let validated;
  try {
    validated = validateInvoice(parsed, {
      expectedEscrow: escrowContract,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    if (error instanceof InvoiceValidationError) {
      return reject(422, "invalid-invoice", error.message);
    }
    return reject(500, "validation-error", "The invoice could not be validated.");
  }

  // --- Sign -----------------------------------------------------------------
  const attestation: ConfidentialAttestation = {
    seller: validated.seller,
    buyer: validated.buyer,
    usdAmountCents: validated.finalTotalCents,
    dueAt: validated.dueAt,
    termsCommitment: validated.termsCommitment,
    attestationId: deriveAttestationId(validated.termsCommitment, validated.seller),
  };

  let signature: Hex;
  try {
    signature = await signAttestation(attestation);
  } catch (error) {
    return reject(
      503,
      "attestor-unavailable",
      error instanceof Error ? error.message : "The attestor could not sign this result.",
    );
  }

  const response: AttestorCreateResponse = {
    ok: true,
    attestation: serialiseAttestation(attestation),
    signature,
  };
  return NextResponse.json(response, { headers: NO_STORE });
}
