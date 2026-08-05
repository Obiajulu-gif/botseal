/**
 * GET /api/fcc/result/<actionId>
 *
 * Proxies the FCC extension proxy's `/action/result/<id>` endpoint.
 *
 * The upstream body is passed through with its `result.data` and `signature` untouched. Those exact
 * bytes are what the browser relays into `relayConfidentialInvoice`; re-encoding any field here
 * would change `ActionResult.Hash()` and break the TEE signature check on-chain.
 *
 * A 404/425 upstream means "not processed yet", which is reported as a 202 so the client keeps
 * polling instead of treating it as a failure.
 */

import { NextResponse } from "next/server";

import { fccProxyUrl } from "@/lib/env";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const REQUEST_TIMEOUT_MS = 10_000;
const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(
  _request: Request,
  context: { params: Promise<{ actionId: string }> },
) {
  const { actionId } = await context.params;

  if (!/^0x[0-9a-fA-F]{64}$/.test(actionId)) {
    return NextResponse.json(
      { error: "invalid-action-id", message: "The action id must be a 32-byte hex string." },
      { status: 400, headers: NO_STORE },
    );
  }

  let upstream: string;
  try {
    upstream = fccProxyUrl();
  } catch (error) {
    return NextResponse.json(
      {
        error: "extension-unavailable",
        message: error instanceof Error ? error.message : "FCC proxy is not configured.",
      },
      { status: 503, headers: NO_STORE },
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${upstream}/action/result/${actionId}`, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (response.status === 404 || response.status === 425) {
      return NextResponse.json({ pending: true }, { status: 202, headers: NO_STORE });
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "upstream-error",
          message: `The FCC proxy returned HTTP ${response.status}.`,
        },
        { status: 502, headers: NO_STORE },
      );
    }

    // Passed through verbatim — see the note at the top of this file.
    const body = await response.json();
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      {
        error: "extension-unavailable",
        message: aborted
          ? "The FCC proxy did not respond in time."
          : "Could not reach the FCC extension proxy.",
      },
      { status: 503, headers: NO_STORE },
    );
  } finally {
    clearTimeout(timer);
  }
}
