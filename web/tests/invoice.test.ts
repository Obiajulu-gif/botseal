/**
 * Money arithmetic. These are the tests that matter most in the frontend: everything downstream
 * — the attestor payload, the quote, the amount approved — is derived from these integers.
 */

import { describe, expect, it } from "vitest";

import {
  computeTotals,
  formatCentsAsCurrency,
  formatCentsToUsd,
  generateSecret,
  MoneyParseError,
  parseQuantity,
  parseUsdToCents,
} from "@/lib/invoice";

describe("parseUsdToCents", () => {
  it("parses whole dollars", () => {
    expect(parseUsdToCents("100")).toBe(10_000n);
  });

  it("parses two decimal places exactly", () => {
    expect(parseUsdToCents("1250.75")).toBe(125_075n);
  });

  it("parses one decimal place as tenths", () => {
    expect(parseUsdToCents("0.5")).toBe(50n);
  });

  it("avoids the float error that would round 0.07 up", () => {
    // Number("0.07") * 100 === 7.000000000000001
    expect(parseUsdToCents("0.07")).toBe(7n);
  });

  it("avoids the float error on 1.15", () => {
    // Number("1.15") * 100 === 114.99999999999999
    expect(parseUsdToCents("1.15")).toBe(115n);
  });

  it("handles amounts beyond IEEE-754 integer precision", () => {
    expect(parseUsdToCents("99999999999999999.99")).toBe(9_999_999_999_999_999_999n);
  });

  it("rejects three decimal places rather than rounding", () => {
    expect(() => parseUsdToCents("10.005")).toThrow(MoneyParseError);
    expect(() => parseUsdToCents("10.005")).toThrow(/two decimal places/);
  });

  it("rejects negative amounts", () => {
    expect(() => parseUsdToCents("-5.00")).toThrow(MoneyParseError);
  });

  it("rejects thousands separators", () => {
    expect(() => parseUsdToCents("1,250.00")).toThrow(MoneyParseError);
  });

  it("rejects an empty string", () => {
    expect(() => parseUsdToCents("   ")).toThrow(/required/);
  });

  it("rejects non-numeric text", () => {
    expect(() => parseUsdToCents("abc")).toThrow(MoneyParseError);
  });

  it("round-trips two-decimal input through formatCentsToUsd", () => {
    for (const value of ["0.01", "0.07", "1.15", "1250.75", "100.00"]) {
      expect(formatCentsToUsd(parseUsdToCents(value))).toBe(value);
    }
  });

  it("normalises shorter input on the way back out", () => {
    expect(formatCentsToUsd(parseUsdToCents("0.5"))).toBe("0.50");
    expect(formatCentsToUsd(parseUsdToCents("100"))).toBe("100.00");
    expect(formatCentsToUsd(0n)).toBe("0.00");
  });
});

describe("formatCentsAsCurrency", () => {
  it("groups thousands", () => {
    expect(formatCentsAsCurrency(125_075n)).toBe("$1,250.75");
    expect(formatCentsAsCurrency(100_000_000n)).toBe("$1,000,000.00");
  });

  it("pads a single-digit cent value", () => {
    expect(formatCentsAsCurrency(7n)).toBe("$0.07");
  });
});

describe("parseQuantity", () => {
  it("accepts whole numbers", () => {
    expect(parseQuantity("40")).toBe(40n);
  });

  it("rejects zero", () => {
    expect(() => parseQuantity("0")).toThrow(/at least 1/);
  });

  it("rejects fractional quantities", () => {
    expect(() => parseQuantity("1.5")).toThrow(/whole number/);
  });

  it("rejects quantities above the attestor's ceiling", () => {
    expect(() => parseQuantity("1000001")).toThrow(/at most/);
  });
});

describe("computeTotals", () => {
  const items = [
    { description: "Design retainer", quantity: "2", unitPriceUsd: "1250.00" },
    { description: "Hosting", quantity: "3", unitPriceUsd: "19.99" },
  ];

  it("computes line totals and the subtotal in exact cents", () => {
    const totals = computeTotals(items, "", "");
    expect(totals.lineTotals).toEqual([250_000n, 5_997n]);
    expect(totals.subtotalCents).toBe(255_997n);
    expect(totals.finalTotalCents).toBe(255_997n);
  });

  it("applies tax and discount as integers", () => {
    const totals = computeTotals(items, "100.00", "50.25");
    expect(totals.discountCents).toBe(10_000n);
    expect(totals.taxCents).toBe(5_025n);
    // 255997 - 10000 + 5025
    expect(totals.finalTotalCents).toBe(251_022n);
  });

  it("treats blank tax and discount as zero", () => {
    const totals = computeTotals(items, "  ", "");
    expect(totals.discountCents).toBe(0n);
    expect(totals.taxCents).toBe(0n);
  });

  it("rejects a discount larger than the subtotal", () => {
    expect(() => computeTotals(items, "999999.00", "")).toThrow(/discount cannot exceed/);
  });

  it("rejects a zero unit price", () => {
    expect(() =>
      computeTotals([{ description: "x", quantity: "1", unitPriceUsd: "0" }], "", ""),
    ).toThrow(/greater than zero/);
  });

  it("rejects a total above the configured maximum", () => {
    expect(() =>
      computeTotals(
        [{ description: "x", quantity: "1000000", unitPriceUsd: "99999999.99" }],
        "",
        "",
      ),
    ).toThrow(/exceeds the maximum/);
  });

  it("matches the attestor formula: subtotal - discount + tax", () => {
    const totals = computeTotals(
      [{ description: "a", quantity: "7", unitPriceUsd: "3.33" }],
      "1.11",
      "0.22",
    );
    expect(totals.subtotalCents).toBe(2_331n);
    expect(totals.finalTotalCents).toBe(2_331n - 111n + 22n);
  });
});

describe("generateSecret", () => {
  it("returns 32 bytes of hex", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not repeat", () => {
    expect(generateSecret()).not.toBe(generateSecret());
  });

  it("meets the attestor's minimum length rule", () => {
    // The extension requires at least 32 characters.
    expect(generateSecret().length).toBeGreaterThanOrEqual(32);
  });
});
