import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formats a unix timestamp for display. Returns an em dash for the unset value. */
export function formatTimestamp(seconds: bigint | number): string {
  const value = typeof seconds === "bigint" ? Number(seconds) : seconds;
  if (!value) return "—";
  return new Date(value * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Formats a unix timestamp as a date only. */
export function formatDate(seconds: bigint | number): string {
  const value = typeof seconds === "bigint" ? Number(seconds) : seconds;
  if (!value) return "—";
  return new Date(value * 1000).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Renders an age in seconds as a compact relative string, e.g. `12s ago`. */
export function formatAge(seconds: number): string {
  if (seconds < 0) return "in the future";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

/**
 * Formats an 18-decimal wei value as a decimal string with the given precision.
 * Used for the XRP/USD price, which FTSOv2 returns normalised to 18 decimals.
 */
export function formatWeiPrice(priceWei: bigint, precision = 6): string {
  const whole = priceWei / 10n ** 18n;
  const fraction = priceWei % 10n ** 18n;
  const padded = fraction.toString().padStart(18, "0").slice(0, precision);
  return `${whole}.${padded}`;
}
