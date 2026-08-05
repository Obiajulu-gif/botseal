/**
 * FCC response normalisation, slippage math, and public-key handling.
 *
 * The normalisation tests encode the wire contract from tee-node's `types.ActionResponse`: a
 * malformed or partial response must never be mistaken for a signed success, because the values are
 * relayed straight into a contract that verifies a signature over them.
 */

import { describe, expect, it } from "vitest";

import {
  applySlippage,
  normaliseFccResponse,
  publicKeyFromInfo,
  FCC_STATUS_PENDING,
  SLIPPAGE_OPTIONS,
} from "@/lib/fcc";

const VALID_SIGNATURE = `0x${"ab".repeat(65)}`;
const ACTION_ID = `0x${"11".repeat(32)}`;
const RESULT_DATA = `0x${"cd".repeat(192)}`;

function successBody(overrides: Record<string, unknown> = {}) {
  return {
    result: {
      id: ACTION_ID,
      submissionTag: "end",
      status: 1,
      log: "",
      data: RESULT_DATA,
      ...overrides,
    },
    signature: VALID_SIGNATURE,
  };
}

describe("normaliseFccResponse", () => {
  it("extracts the five relay fields from a signed success", () => {
    const state = normaliseFccResponse(successBody());
    expect(state.kind).toBe("success");
    if (state.kind !== "success") return;

    expect(state.result.actionId).toBe(ACTION_ID);
    expect(state.result.submissionTag).toBe("end");
    expect(state.result.status).toBe(1);
    expect(state.result.data).toBe(RESULT_DATA);
    expect(state.result.signature).toBe(VALID_SIGNATURE);
  });

  it("passes result data through byte-for-byte", () => {
    const state = normaliseFccResponse(successBody());
    if (state.kind !== "success") throw new Error("expected success");
    // Re-encoding would change ActionResult.Hash() and break on-chain verification.
    expect(state.result.data).toBe(RESULT_DATA);
    expect(state.result.data.length).toBe(RESULT_DATA.length);
  });

  it("treats status 2 as still pending", () => {
    const state = normaliseFccResponse(successBody({ status: FCC_STATUS_PENDING }));
    expect(state.kind).toBe("pending");
  });

  it("treats an empty body as pending", () => {
    expect(normaliseFccResponse({}).kind).toBe("pending");
    expect(normaliseFccResponse(null).kind).toBe("pending");
    expect(normaliseFccResponse({ pending: true }).kind).toBe("pending");
  });

  it("surfaces the TEE's rejection log on status 0", () => {
    const state = normaliseFccResponse(
      successBody({ status: 0, log: "items[0].quantity must be between 1 and 1000000" }),
    );
    expect(state.kind).toBe("error");
    if (state.kind !== "error") return;
    expect(state.message).toContain("quantity");
  });

  it("gives a generic message when a rejection carries no log", () => {
    const state = normaliseFccResponse(successBody({ status: 0, log: "" }));
    expect(state.kind).toBe("error");
    if (state.kind !== "error") return;
    expect(state.message).toMatch(/rejected/i);
  });

  it("rejects a success that carries no result data", () => {
    const state = normaliseFccResponse(successBody({ data: "0x" }));
    expect(state.kind).toBe("error");
    if (state.kind !== "error") return;
    expect(state.message).toMatch(/no result data/i);
  });

  it("rejects a signature that is not 65 bytes", () => {
    const body = { ...successBody(), signature: `0x${"ab".repeat(64)}` };
    const state = normaliseFccResponse(body);
    expect(state.kind).toBe("error");
    if (state.kind !== "error") return;
    expect(state.message).toMatch(/65 bytes/);
  });

  it("rejects a missing signature", () => {
    const body = { result: successBody().result };
    const state = normaliseFccResponse(body);
    expect(state.kind).toBe("error");
  });

  it("rejects non-hex result data", () => {
    const state = normaliseFccResponse(successBody({ data: "not-hex" }));
    expect(state.kind).toBe("error");
  });

  it("rejects an unknown status", () => {
    const state = normaliseFccResponse(successBody({ status: 7 }));
    expect(state.kind).toBe("error");
    if (state.kind !== "error") return;
    expect(state.message).toContain("7");
  });

  it("reports a missing status rather than assuming success", () => {
    const state = normaliseFccResponse({ result: { id: ACTION_ID }, signature: VALID_SIGNATURE });
    expect(state.kind).toBe("error");
  });
});

describe("applySlippage", () => {
  it("adds 1% to a round amount", () => {
    expect(applySlippage(1_000_000n, 100n)).toBe(1_010_000n);
  });

  it("adds 0.5%", () => {
    expect(applySlippage(200_000_000n, 50n)).toBe(201_000_000n);
  });

  it("adds 2%", () => {
    expect(applySlippage(50_000_000n, 200n)).toBe(51_000_000n);
  });

  it("rounds up so the ceiling is never a wei short", () => {
    // 333 * 10050 / 10000 = 334.665 -> 335
    expect(applySlippage(333n, 50n)).toBe(335n);
  });

  it("returns the input unchanged at zero slippage", () => {
    expect(applySlippage(12_345n, 0n)).toBe(12_345n);
  });

  it("handles zero", () => {
    expect(applySlippage(0n, 100n)).toBe(0n);
  });

  it("rejects negative input", () => {
    expect(() => applySlippage(-1n, 100n)).toThrow();
    expect(() => applySlippage(100n, -1n)).toThrow();
  });

  it("never returns less than the quoted amount for the offered options", () => {
    const quoted = 987_654_321n;
    for (const option of SLIPPAGE_OPTIONS) {
      expect(applySlippage(quoted, option.bps)).toBeGreaterThanOrEqual(quoted);
    }
  });
});

describe("publicKeyFromInfo", () => {
  it("builds an uncompressed key from the x/y point", () => {
    const x = `0x${"11".repeat(32)}`;
    const y = `0x${"22".repeat(32)}`;
    expect(publicKeyFromInfo(x, y)).toBe(`0x04${"11".repeat(32)}${"22".repeat(32)}`);
  });

  it("left-pads a coordinate that was serialised short", () => {
    const key = publicKeyFromInfo("0x01", `0x${"22".repeat(32)}`);
    // 0x04 + 64 hex + 64 hex
    expect(key.length).toBe(2 + 2 + 128);
    expect(key.startsWith(`0x04${"0".repeat(62)}01`)).toBe(true);
  });

  it("accepts coordinates without a 0x prefix", () => {
    expect(publicKeyFromInfo("11".repeat(32), "22".repeat(32))).toBe(
      `0x04${"11".repeat(32)}${"22".repeat(32)}`,
    );
  });

  it("rejects a non-hex coordinate", () => {
    expect(() => publicKeyFromInfo("0xzz", `0x${"22".repeat(32)}`)).toThrow(/public key/);
  });

  it("rejects an empty coordinate", () => {
    expect(() => publicKeyFromInfo("0x", `0x${"22".repeat(32)}`)).toThrow();
  });

  it("rejects an oversized coordinate", () => {
    expect(() => publicKeyFromInfo(`0x${"11".repeat(33)}`, `0x${"22".repeat(32)}`)).toThrow();
  });
});
