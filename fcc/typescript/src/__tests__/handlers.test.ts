/** INVOICE/CREATE handler: decryption seam, result encoding, and privacy guarantees. */

import { decodeAbiParameters } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INVOICE_RESULT_PARAMS } from "../app/abi.js";
import * as handlers from "../app/handlers.js";
import { bytesToHex } from "../base/encoding.js";
import type { HandlerResult } from "../base/types.js";

const SELLER = "0x1111111111111111111111111111111111111111";
const BUYER = "0x2222222222222222222222222222222222222222";
const ESCROW = "0x3333333333333333333333333333333333333333";

const NONCE = "a".repeat(64);
const SALT = "b".repeat(64);

function futureDueAt(daysAhead = 30): number {
  return Math.floor(Date.now() / 1000) + daysAhead * 24 * 3600;
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    seller: SELLER,
    buyer: BUYER,
    escrowContract: ESCROW,
    invoiceReference: "INV-001",
    dueAt: futureDueAt(),
    currency: "USD",
    items: [
      { description: "Retainer", quantity: "2", unitPriceCents: "5000" },
      { description: "Security review", quantity: "1", unitPriceCents: "12550" },
    ],
    discountCents: "500",
    taxCents: "1804",
    ...overrides,
    nonce: NONCE,
    salt: SALT,
  };
}

/** Stands in for the on-chain ciphertext. The identity decryptor below "decrypts" it. */
function ciphertextFor(obj: unknown): string {
  return bytesToHex(Buffer.from(JSON.stringify(obj), "utf-8"));
}

function decodeResult(result: HandlerResult) {
  const [seller, buyer, escrowContract, usdAmountCents, dueAt, termsCommitment] =
    decodeAbiParameters(INVOICE_RESULT_PARAMS, result[0] as `0x${string}`);
  return { seller, buyer, escrowContract, usdAmountCents, dueAt, termsCommitment };
}

beforeEach(() => {
  handlers.resetState();
  process.env.ESCROW_CONTRACT_ADDRESS = ESCROW;
  // The real path calls tee-node on the sign port. Unit tests swap in an identity decryptor so
  // the handler logic is exercised without a running TEE.
  handlers.setDecryptor(async (ciphertext) => ciphertext);
});

afterEach(() => {
  handlers.resetState();
  handlers.resetDecryptor();
  delete process.env.ESCROW_CONTRACT_ADDRESS;
  vi.restoreAllMocks();
});

describe("handleCreateInvoice — success", () => {
  it("returns status 1 and the ABI-encoded public result", async () => {
    const result = await handlers.handleCreateInvoice(ciphertextFor(payload()));

    expect(result[1]).toBe(1);
    expect(result[2]).toBeNull();

    const decoded = decodeResult(result);
    expect(decoded.seller).toBe(SELLER);
    expect(decoded.buyer).toBe(BUYER);
    expect(decoded.escrowContract).toBe(ESCROW);
    // 22550 - 500 + 1804
    expect(decoded.usdAmountCents).toBe(23_854n);
    expect(decoded.termsCommitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(decoded.termsCommitment).not.toBe(`0x${"0".repeat(64)}`);
  });

  it("encodes a flat parameter list, not a tuple", async () => {
    const result = await handlers.handleCreateInvoice(ciphertextFor(payload()));
    // Six 32-byte words, no leading offset word.
    expect((result[0] as string).length).toBe(2 + 6 * 64);
  });

  it("counts successes in reported state", async () => {
    await handlers.handleCreateInvoice(ciphertextFor(payload()));
    await handlers.handleCreateInvoice(ciphertextFor(payload({ invoiceReference: "INV-002" })));

    expect(handlers.reportState()).toEqual({
      invoicesProcessed: 2,
      invoicesRejected: 0,
      lastStatus: "success",
    });
  });
});

describe("handleCreateInvoice — failures", () => {
  it("rejects invalid hex", async () => {
    const result = await handlers.handleCreateInvoice("0xZZ");
    expect(result[1]).toBe(0);
    expect(result[2]).toMatch(/invalid hex/);
  });

  it("rejects an empty payload", async () => {
    const result = await handlers.handleCreateInvoice("0x");
    expect(result[1]).toBe(0);
    expect(result[2]).toMatch(/empty payload/);
  });

  it("reports a decryption failure without leaking the node's error text", async () => {
    handlers.setDecryptor(async () => {
      throw new Error("node returned 400: ciphertext 0xdeadbeef is malformed");
    });

    const result = await handlers.handleCreateInvoice(ciphertextFor(payload()));
    expect(result[1]).toBe(0);
    expect(result[2]).toBe("decryption failed");
    expect(result[2]).not.toMatch(/deadbeef/);
  });

  it("rejects malformed JSON", async () => {
    const result = await handlers.handleCreateInvoice(
      bytesToHex(Buffer.from("{not json", "utf-8")),
    );
    expect(result[1]).toBe(0);
    expect(result[2]).toMatch(/not valid JSON/);
  });

  it("rejects when the extension has no escrow configured", async () => {
    delete process.env.ESCROW_CONTRACT_ADDRESS;
    const result = await handlers.handleCreateInvoice(ciphertextFor(payload()));
    expect(result[1]).toBe(0);
    expect(result[2]).toMatch(/ESCROW_CONTRACT_ADDRESS/);
  });

  it("rejects an invoice addressed to a different escrow", async () => {
    const result = await handlers.handleCreateInvoice(
      ciphertextFor(payload({ escrowContract: "0x4444444444444444444444444444444444444444" })),
    );
    expect(result[1]).toBe(0);
    expect(result[2]).toMatch(/configured escrow/);
  });

  it("rejects a past due date", async () => {
    const result = await handlers.handleCreateInvoice(
      ciphertextFor(payload({ dueAt: Math.floor(Date.now() / 1000) - 60 })),
    );
    expect(result[1]).toBe(0);
    expect(result[2]).toMatch(/dueAt must be in the future/);
  });

  it("returns null data on failure so the wire result carries 0x", async () => {
    const result = await handlers.handleCreateInvoice(ciphertextFor(payload({ items: [] })));
    expect(result[0]).toBeNull();
  });

  it("counts rejections in reported state", async () => {
    await handlers.handleCreateInvoice("0x");
    expect(handlers.reportState()).toEqual({
      invoicesProcessed: 0,
      invoicesRejected: 1,
      lastStatus: "error",
    });
  });
});

describe("privacy", () => {
  it("never echoes invoice content in an error message", async () => {
    const secret = "Acme Corp confidential retainer";
    const result = await handlers.handleCreateInvoice(
      ciphertextFor(
        payload({
          items: [{ description: secret, quantity: "0", unitPriceCents: "100" }],
        }),
      ),
    );

    expect(result[1]).toBe(0);
    expect(result[2]).not.toContain(secret);
    expect(result[2]).not.toContain("Acme");
  });

  it("never writes invoice content to the log", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });

    const secret = "Acme Corp confidential retainer";
    await handlers.handleCreateInvoice(
      ciphertextFor(
        payload({
          items: [{ description: secret, quantity: "1", unitPriceCents: "100" }],
          // The base payload's $5.00 discount would exceed this one-item subtotal and the
          // invoice would be rejected before it ever reached the success log.
          discountCents: "0",
          taxCents: "0",
        }),
      ),
    );

    const combined = logs.join("\n");
    expect(combined).not.toContain(secret);
    expect(combined).not.toContain("Acme");
    expect(combined).not.toContain(NONCE);
    expect(combined).not.toContain(SALT);
    expect(combined).toContain("INVOICE/CREATE succeeded");
  });

  it("does not expose the nonce or salt in the public result", async () => {
    const result = await handlers.handleCreateInvoice(ciphertextFor(payload()));
    const data = result[0] as string;

    expect(data).not.toContain(NONCE);
    expect(data).not.toContain(SALT);
  });

  it("does not expose the reference or descriptions in the public result", async () => {
    const result = await handlers.handleCreateInvoice(
      ciphertextFor(payload({ invoiceReference: "TOP-SECRET-REF" })),
    );
    const dataBytes = Buffer.from((result[0] as string).slice(2), "hex").toString("utf-8");

    expect(dataBytes).not.toContain("TOP-SECRET-REF");
    expect(dataBytes).not.toContain("Retainer");
  });
});
