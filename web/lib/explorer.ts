/**
 * Coston2 explorer URL construction.
 *
 * The base URL comes from the environment so a self-hosted or mirrored explorer works without a
 * code change. Trailing slashes are normalised so `.../tx//0x…` can never be produced.
 */

import { env } from "./env";

function base(): string {
  return env.explorerUrl.replace(/\/+$/, "");
}

export function txUrl(hash: string): string {
  return `${base()}/tx/${hash}`;
}

export function addressUrl(address: string): string {
  return `${base()}/address/${address}`;
}

export function blockUrl(block: bigint | number): string {
  return `${base()}/block/${block.toString()}`;
}

/** Shortens a hash or address for display: `0x1234…cdef`. */
export function shortenHex(value: string, lead = 6, tail = 4): string {
  if (!value.startsWith("0x")) return value;
  if (value.length <= lead + tail + 2) return value;
  return `${value.slice(0, 2 + lead)}…${value.slice(-tail)}`;
}
