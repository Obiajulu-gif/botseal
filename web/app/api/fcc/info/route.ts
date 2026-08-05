/**
 * GET /api/fcc/info
 *
 * Proxies the FCC extension proxy's `/info` endpoint and returns only what the browser needs:
 * the ECIES public key, the derived TEE signing address, and two display fields.
 *
 * Deliberately withheld: the attestation document, machine data, proxy signature, and the proxy URL
 * itself. None of them are needed to encrypt an invoice, and the URL is a tunnel address.
 */

import { NextResponse } from "next/server";
import { publicKeyToAddress } from "viem/utils";

import { fccProxyUrl } from "@/lib/env";
import { publicKeyFromInfo, type ExtensionInfo } from "@/lib/fcc";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const REQUEST_TIMEOUT_MS = 8_000;

interface UpstreamInfo {
  teeInfo?: {
    publicKey?: { x?: string; y?: string };
    chainId?: number;
  };
  machineData?: {
    extensionId?: string;
  };
}

export async function GET() {
  let upstream: string;
  try {
    upstream = fccProxyUrl();
  } catch (error) {
    return NextResponse.json(
      {
        error: "extension-unavailable",
        message: error instanceof Error ? error.message : "FCC proxy is not configured.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${upstream}/info`, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "extension-unavailable",
          message: `The FCC proxy returned HTTP ${response.status}.`,
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const body = (await response.json()) as UpstreamInfo;
    const point = body.teeInfo?.publicKey;

    if (!point?.x || !point?.y) {
      return NextResponse.json(
        {
          error: "invalid-info",
          message: "The FCC proxy /info response did not contain teeInfo.publicKey.",
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const publicKey = publicKeyFromInfo(point.x, point.y);

    const info: ExtensionInfo = {
      publicKey,
      // Same derivation the escrow's configure-tee script uses, so the address shown here is the
      // one whose signature the contract will accept.
      teeAddress: publicKeyToAddress(publicKey),
      extensionId: body.machineData?.extensionId,
      chainId: body.teeInfo?.chainId,
    };

    return NextResponse.json(info, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      {
        error: "extension-unavailable",
        message: aborted
          ? "The FCC proxy did not respond in time."
          : "Could not reach the FCC extension proxy.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    clearTimeout(timer);
  }
}
