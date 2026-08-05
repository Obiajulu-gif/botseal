/** FlareSeal invoice validation, integer arithmetic, and commitment determinism. */

import { describe, expect, it } from "vitest";

import { computeTermsCommitment, validateInvoice } from "../app/invoice.js";

const SELLER = "0x1111111111111111111111111111111111111111";
const BUYER = "0x2222222222222222222222222222222222222222";
const ESCROW = "0x3333333333333333333333333333333333333333";
const OTHER_ESCROW = "0x4444444444444444444444444444444444444444";

const NOW = 1_800_000_000;
const DUE = NOW + 30 * 24 * 3600;

const NONCE = "a".repeat(64);
const SALT = "b".repeat(64);

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    seller: SELLER,
    buyer: BUYER,
    escrowContract: ESCROW,
    invoiceReference: "INV-001",
    dueAt: DUE,
    currency: "USD",
    items: [{ description: "Consulting", quantity: "2", unitPriceCents: "5000" }],
    discountCents: "0",
    taxCents: "0",
    nonce: NONCE,
    salt: SALT,
    ...overrides,
  };
}

function run(payload: unknown, expectedEscrow = ESCROW) {
  return validateInvoice(payload, { expectedEscrow, nowSeconds: NOW });
}

function expectRejected(payload: unknown, matching: RegExp, expectedEscrow = ESCROW) {
  expect(() => run(payload, expectedEscrow)).toThrowError(matching);
}

describe("valid invoices", () => {
  it("accepts a single-item invoice and computes the total", () => {
    const result = run(basePayload());

    expect(result.subtotalCents).toBe(10_000n); // 2 x $50.00
    expect(result.finalTotalCents).toBe(10_000n);
    expect(result.seller).toBe(SELLER);
    expect(result.buyer).toBe(BUYER);
    expect(result.dueAt).toBe(BigInt(DUE));
    expect(result.termsCommitment).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("accepts a multi-item invoice", () => {
    const result = run(
      basePayload({
        items: [
          { description: "Retainer", quantity: "2", unitPriceCents: "5000" },
          { description: "Security review", quantity: "1", unitPriceCents: "12550" },
        ],
      }),
    );

    expect(result.subtotalCents).toBe(22_550n);
    expect(result.finalTotalCents).toBe(22_550n);
  });

  it("applies discount and tax as exact integer cents", () => {
    const result = run(
      basePayload({
        items: [
          { description: "Retainer", quantity: "2", unitPriceCents: "5000" },
          { description: "Security review", quantity: "1", unitPriceCents: "12550" },
        ],
        discountCents: "500",
        taxCents: "1804",
      }),
    );

    // 22550 - 500 + 1804
    expect(result.subtotalCents).toBe(22_550n);
    expect(result.discountCents).toBe(500n);
    expect(result.taxCents).toBe(1804n);
    expect(result.finalTotalCents).toBe(23_854n);
  });

  it("allows a discount exactly equal to the subtotal when tax keeps the total positive", () => {
    const result = run(basePayload({ discountCents: "10000", taxCents: "1" }));
    expect(result.finalTotalCents).toBe(1n);
  });

  it("normalises address casing so commitments do not depend on it", () => {
    const lower = run(basePayload({ seller: SELLER.toLowerCase() }));
    const upper = run(basePayload({ seller: `0x${SELLER.slice(2).toUpperCase()}` }));
    expect(lower.termsCommitment).toBe(upper.termsCommitment);
  });

  it("computes large line totals exactly", () => {
    const result = run(
      basePayload({
        items: [{ description: "Bulk", quantity: "1000000", unitPriceCents: "9999" }],
      }),
    );
    // 1,000,000 x 9,999 with no rounding anywhere.
    expect(result.finalTotalCents).toBe(9_999_000_000n);
  });

  it("computes a line total beyond Number.MAX_SAFE_INTEGER without rounding", () => {
    // 1,000,000 x 9,999,999,999 = 9,999,999,999,000,000, which is larger than
    // Number.MAX_SAFE_INTEGER (9,007,199,254,740,991). Float arithmetic would silently round it;
    // bigint arithmetic computes it exactly and the total then trips the configured ceiling.
    const lineTotal = 1_000_000n * 9_999_999_999n;
    expect(lineTotal > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);

    expectRejected(
      basePayload({
        items: [{ description: "Bulk", quantity: "1000000", unitPriceCents: "9999999999" }],
      }),
      /exceeds the configured maximum/,
    );
  });
});

describe("commitment determinism", () => {
  it("produces identical commitments for identical inputs", () => {
    expect(run(basePayload()).termsCommitment).toBe(run(basePayload()).termsCommitment);
  });

  it("changes when any field changes", () => {
    const baseline = run(basePayload()).termsCommitment;

    const variants: Array<Record<string, unknown>> = [
      { invoiceReference: "INV-002" },
      { buyer: "0x5555555555555555555555555555555555555555" },
      { dueAt: DUE + 1 },
      { taxCents: "1" },
      { discountCents: "1" },
      { nonce: "c".repeat(64) },
      { salt: "d".repeat(64) },
      { items: [{ description: "Consulting", quantity: "3", unitPriceCents: "5000" }] },
      { items: [{ description: "Consulting", quantity: "2", unitPriceCents: "5001" }] },
      { items: [{ description: "Consulting!", quantity: "2", unitPriceCents: "5000" }] },
    ];

    for (const variant of variants) {
      expect(run(basePayload(variant)).termsCommitment, JSON.stringify(variant)).not.toBe(
        baseline,
      );
    }
  });

  it("is order-sensitive across line items", () => {
    const a = run(
      basePayload({
        items: [
          { description: "A", quantity: "1", unitPriceCents: "100" },
          { description: "B", quantity: "1", unitPriceCents: "200" },
        ],
      }),
    );
    const b = run(
      basePayload({
        items: [
          { description: "B", quantity: "1", unitPriceCents: "200" },
          { description: "A", quantity: "1", unitPriceCents: "100" },
        ],
      }),
    );

    expect(a.finalTotalCents).toBe(b.finalTotalCents);
    expect(a.termsCommitment).not.toBe(b.termsCommitment);
  });

  it("computeTermsCommitment is a pure function of its inputs", () => {
    const input = {
      seller: SELLER as `0x${string}`,
      buyer: BUYER as `0x${string}`,
      escrowContract: ESCROW as `0x${string}`,
      invoiceReference: "INV-001",
      itemHashes: [`0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`] as `0x${string}`[],
      discountCents: 1n,
      taxCents: 2n,
      finalTotalCents: 3n,
      dueAt: 4n,
      nonce: NONCE,
      salt: SALT,
    };
    expect(computeTermsCommitment(input)).toBe(computeTermsCommitment(input));
  });
});

describe("rejections", () => {
  it("rejects a non-object payload", () => {
    expectRejected("nope", /JSON object/);
    expectRejected([], /JSON object/);
    expectRejected(null, /JSON object/);
  });

  it("rejects a wrong version", () => {
    expectRejected(basePayload({ version: 2 }), /version must be 1/);
  });

  it("rejects a non-USD currency", () => {
    expectRejected(basePayload({ currency: "EUR" }), /currency must be USD/);
  });

  it("rejects an invalid address", () => {
    expectRejected(basePayload({ buyer: "0xnope" }), /buyer must be a valid EVM address/);
    expectRejected(basePayload({ seller: 42 }), /seller must be a valid EVM address/);
  });

  it("rejects seller equal to buyer", () => {
    expectRejected(basePayload({ buyer: SELLER }), /must be different addresses/);
  });

  it("rejects a result addressed to a different escrow", () => {
    expectRejected(
      basePayload(),
      /does not match this extension's configured escrow/,
      OTHER_ESCROW,
    );
  });

  it("rejects empty items", () => {
    expectRejected(basePayload({ items: [] }), /at least one entry/);
  });

  it("rejects too many items", () => {
    const items = Array.from({ length: 21 }, (_, i) => ({
      description: `Item ${i}`,
      quantity: "1",
      unitPriceCents: "100",
    }));
    expectRejected(basePayload({ items }), /at most 20 entries/);
  });

  it("rejects zero quantity", () => {
    expectRejected(
      basePayload({ items: [{ description: "X", quantity: "0", unitPriceCents: "100" }] }),
      /quantity must be between/,
    );
  });

  it("rejects a quantity above the cap", () => {
    expectRejected(
      basePayload({ items: [{ description: "X", quantity: "1000001", unitPriceCents: "1" }] }),
      /quantity must be between/,
    );
  });

  it("rejects zero unit price", () => {
    expectRejected(
      basePayload({ items: [{ description: "X", quantity: "1", unitPriceCents: "0" }] }),
      /unitPriceCents must be greater than zero/,
    );
  });

  it("rejects non-integer numeric strings", () => {
    expectRejected(
      basePayload({ items: [{ description: "X", quantity: "1.5", unitPriceCents: "100" }] }),
      /must be a non-negative integer/,
    );
    expectRejected(
      basePayload({ items: [{ description: "X", quantity: "1", unitPriceCents: "1_000" }] }),
      /must be a non-negative integer/,
    );
    expectRejected(
      basePayload({ items: [{ description: "X", quantity: "007", unitPriceCents: "100" }] }),
      /leading zeros/,
    );
  });

  it("rejects numbers supplied as JSON numbers rather than strings", () => {
    expectRejected(
      basePayload({ items: [{ description: "X", quantity: 1, unitPriceCents: "100" }] }),
      /must be a decimal string/,
    );
  });

  it("rejects an overflow-sized numeric string", () => {
    expectRejected(
      basePayload({ items: [{ description: "X", quantity: "1", unitPriceCents: "9".repeat(40) }] }),
      /maximum supported magnitude/,
    );
  });

  it("rejects a discount larger than the subtotal", () => {
    expectRejected(basePayload({ discountCents: "10001" }), /cannot exceed the subtotal/);
  });

  it("rejects a zero total", () => {
    expectRejected(
      basePayload({ discountCents: "10000", taxCents: "0" }),
      /total must be greater than zero/,
    );
  });

  it("rejects a total above the configured maximum", () => {
    const items = Array.from({ length: 20 }, () => ({
      description: "Big",
      quantity: "1000000",
      unitPriceCents: "999999",
    }));
    expectRejected(basePayload({ items }), /exceeds the configured maximum/);
  });

  it("rejects a past due date", () => {
    expectRejected(basePayload({ dueAt: NOW - 1 }), /dueAt must be in the future/);
    expectRejected(basePayload({ dueAt: NOW }), /dueAt must be in the future/);
  });

  it("rejects a due date beyond 366 days", () => {
    expectRejected(
      basePayload({ dueAt: NOW + 367 * 24 * 3600 }),
      /no more than 366 days/,
    );
  });

  it("rejects a non-integer due date", () => {
    expectRejected(basePayload({ dueAt: "soon" }), /integer unix timestamp/);
    expectRejected(basePayload({ dueAt: DUE + 0.5 }), /integer unix timestamp/);
  });

  it("rejects a short nonce or salt", () => {
    expectRejected(basePayload({ nonce: "abc" }), /nonce length must be between/);
    expectRejected(basePayload({ salt: "abc" }), /salt length must be between/);
  });

  it("rejects an empty or overlong reference", () => {
    expectRejected(basePayload({ invoiceReference: "" }), /invoiceReference length/);
    expectRejected(basePayload({ invoiceReference: "x".repeat(81) }), /invoiceReference length/);
  });

  it("rejects an empty or overlong description", () => {
    expectRejected(
      basePayload({ items: [{ description: "", quantity: "1", unitPriceCents: "1" }] }),
      /description length/,
    );
    expectRejected(
      basePayload({
        items: [{ description: "x".repeat(201), quantity: "1", unitPriceCents: "1" }],
      }),
      /description length/,
    );
  });

  it("rejects when the extension has no valid escrow configured", () => {
    expectRejected(basePayload(), /not configured with a valid ESCROW_CONTRACT_ADDRESS/, "nope");
  });
});
