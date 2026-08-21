/**
 * GET /api/attestor/info
 *
 * Reports what the browser needs in order to encrypt an invoice: the ECIES public key, the address
 * the escrow verifies against, and the chain and escrow this attestor is bound to.
 *
 * The private key never appears here. `publicKey` is derived from it and is public by definition —
 * it is the encryption recipient.
 */

import { NextResponse } from "next/server";

import type { AttestorInfo } from "@/lib/attestor";
import {
  attestorAccount,
  configuredChainId,
  configuredEscrow,
} from "@/lib/attestor/signer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const account = attestorAccount();

    const info: AttestorInfo = {
      publicKey: account.publicKey,
      attestorAddress: account.address,
      chainId: configuredChainId(),
      escrowContract: configuredEscrow(),
    };

    return NextResponse.json(info, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      {
        error: "attestor-unavailable",
        message:
          error instanceof Error ? error.message : "The attestor service is not configured.",
      },
      { status: 503, headers: NO_STORE },
    );
  }
}
