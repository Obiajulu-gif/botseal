/** Server routing and wire format — docs/extension-contract.md §2, §4. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { VERSION } from "../app/config.js";
import * as handlers from "../app/handlers.js";
import { bytesToHex, stringToBytes32Hex } from "../base/encoding.js";
import { Server } from "../base/server.js";

const SELLER = "0x1111111111111111111111111111111111111111";
const BUYER = "0x2222222222222222222222222222222222222222";
const ESCROW = "0x3333333333333333333333333333333333333333";

let srv: Server;

beforeEach(() => {
  handlers.resetState();
  process.env.ESCROW_CONTRACT_ADDRESS = ESCROW;
  handlers.setDecryptor(async (ciphertext) => ciphertext);
  srv = new Server(0, 0, VERSION, handlers.register, handlers.reportState);
});

afterEach(() => {
  handlers.resetState();
  handlers.resetDecryptor();
  delete process.env.ESCROW_CONTRACT_ADDRESS;
});

function validInvoice(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    seller: SELLER,
    buyer: BUYER,
    escrowContract: ESCROW,
    invoiceReference: "INV-001",
    dueAt: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    currency: "USD",
    items: [{ description: "Retainer", quantity: "2", unitPriceCents: "5000" }],
    discountCents: "0",
    taxCents: "0",
    nonce: "a".repeat(64),
    salt: "b".repeat(64),
    ...overrides,
  };
}

/** Build a POST /action body in the exact shape tee-node sends. */
function buildAction(
  opts: {
    opType?: string;
    opCommand?: string;
    original?: Buffer | Uint8Array;
    actionId?: string;
  } = {},
): string {
  const {
    opType = "INVOICE",
    opCommand = "CREATE",
    original = Buffer.from(JSON.stringify(validInvoice()), "utf-8"),
    actionId = `0x${"11".repeat(32)}`,
  } = opts;

  const dataFixed = {
    instructionId: actionId,
    teeId: `0x${"22".repeat(20)}`,
    timestamp: 1700000000,
    rewardEpochId: 42,
    opType: stringToBytes32Hex(opType),
    opCommand: stringToBytes32Hex(opCommand),
    cosigners: [],
    cosignersThreshold: 0,
    originalMessage: bytesToHex(new Uint8Array(original)),
    additionalFixedMessage: "0x",
  };

  return JSON.stringify({
    data: {
      id: actionId,
      type: "instruction",
      submissionTag: "submit",
      message: bytesToHex(Buffer.from(JSON.stringify(dataFixed), "utf-8")),
    },
    additionalVariableMessages: [],
    timestamps: [],
    additionalActionData: "0x",
    signatures: [],
  });
}

describe("routing", () => {
  it("returns 405 for GET /action", async () => {
    expect((await srv.handleRequest("GET", "/action", ""))[0]).toBe(405);
  });

  it("returns 405 for POST /state", async () => {
    expect((await srv.handleRequest("POST", "/state", ""))[0]).toBe(405);
  });

  it("returns 404 for unknown paths", async () => {
    expect((await srv.handleRequest("GET", "/nope", ""))[0]).toBe(404);
    expect((await srv.handleRequest("POST", "/nope", ""))[0]).toBe(404);
  });

  it("returns 501 for an unknown op type", async () => {
    const [status, body] = await srv.handleRequest(
      "POST", "/action", buildAction({ opType: "NOPE" }),
    );
    expect(status).toBe(501);
    expect(body).toBe("unsupported op type");
  });

  it("returns 501 for an unknown op command", async () => {
    const [status] = await srv.handleRequest(
      "POST", "/action", buildAction({ opCommand: "NOPE" }),
    );
    expect(status).toBe(501);
  });

  it("returns 501 for the scaffold's old GREETING op type", async () => {
    // Pins the rename: leaving a stale handler registered would silently accept old traffic.
    const [status] = await srv.handleRequest(
      "POST", "/action", buildAction({ opType: "GREETING", opCommand: "SAY_HELLO" }),
    );
    expect(status).toBe(501);
  });

  it("ignores the query string", async () => {
    expect((await srv.handleRequest("GET", "/state?verbose=1", ""))[0]).toBe(200);
  });
});

describe("malformed input", () => {
  it("returns 400 for a non-JSON body", async () => {
    expect((await srv.handleRequest("POST", "/action", "not json"))[0]).toBe(400);
  });

  it("returns 400 when data is missing", async () => {
    expect((await srv.handleRequest("POST", "/action", '{"foo":1}'))[0]).toBe(400);
  });

  it("returns 400 for invalid hex in message", async () => {
    const body = JSON.stringify({
      data: { id: "0x1", type: "instruction", submissionTag: "submit", message: "0xZZ" },
    });
    expect((await srv.handleRequest("POST", "/action", body))[0]).toBe(400);
  });

  it("returns 400 when message is not JSON", async () => {
    const body = JSON.stringify({
      data: {
        id: "0x1", type: "instruction", submissionTag: "submit",
        message: bytesToHex(Buffer.from("not json")),
      },
    });
    expect((await srv.handleRequest("POST", "/action", body))[0]).toBe(400);
  });
});

describe("ActionResult wire format", () => {
  it("returns the success shape", async () => {
    const [status, body] = await srv.handleRequest("POST", "/action", buildAction());
    const r = body as Record<string, unknown>;

    expect(status).toBe(200);
    expect(r.status).toBe(1);
    expect(r.log).toBe("ok");
    expect(r.opType).toBe(stringToBytes32Hex("INVOICE"));
    expect(r.opCommand).toBe(stringToBytes32Hex("CREATE"));
    expect(String(r.data).startsWith("0x")).toBe(true);
    // Six ABI words: seller, buyer, escrow, total, dueAt, commitment.
    expect(String(r.data).length).toBe(2 + 6 * 64);
  });

  it("sends version as a plain string, not bytes32", async () => {
    // Contract §4.4: tee-node declares `Version string`.
    const [, body] = await srv.handleRequest("POST", "/action", buildAction());
    const r = body as Record<string, unknown>;

    expect(r.version).toBe("0.1.0");
    expect(String(r.version).startsWith("0x")).toBe(false);
  });

  it("reports handler failure as HTTP 200 with status 0", async () => {
    const original = Buffer.from(JSON.stringify(validInvoice({ items: [] })), "utf-8");
    const [status, body] = await srv.handleRequest(
      "POST", "/action", buildAction({ original }),
    );
    const r = body as Record<string, unknown>;

    expect(status).toBe(200);
    expect(r.status).toBe(0);
    expect(String(r.log).startsWith("error: ")).toBe(true);
    // Present as "0x", not omitted: the Go struct has no omitempty.
    expect(r.data).toBe("0x");
  });

  it("always emits every field", async () => {
    const [, body] = await srv.handleRequest("POST", "/action", buildAction());
    const r = body as Record<string, unknown>;

    expect(Object.keys(r).sort()).toEqual([
      "additionalResultStatus", "data", "id", "log", "opCommand",
      "opType", "status", "submissionTag", "version",
    ]);
    expect(r.additionalResultStatus).toBe("0x");
  });

  it("echoes id and submissionTag", async () => {
    const actionId = `0x${"ab".repeat(32)}`;
    const [, body] = await srv.handleRequest("POST", "/action", buildAction({ actionId }));
    const r = body as Record<string, unknown>;

    expect(r.id).toBe(actionId);
    expect(r.submissionTag).toBe("submit");
  });
});

describe("state wire format", () => {
  it("sends stateVersion as bytes32", async () => {
    // Asymmetric with ActionResult.version by design — contract §4.5.
    const [status, body] = await srv.handleRequest("GET", "/state", "");
    const r = body as Record<string, unknown>;

    expect(status).toBe(200);
    expect(r.stateVersion).toBe(stringToBytes32Hex("0.1.0"));
    expect(String(r.stateVersion).length).toBe(66);
  });

  it("reflects handler effects", async () => {
    await srv.handleRequest("POST", "/action", buildAction());
    const [, body] = await srv.handleRequest("GET", "/state", "");
    const state = (body as { state: Record<string, unknown> }).state;

    expect(state.invoicesProcessed).toBe(1);
    expect(state.lastStatus).toBe("success");
  });

  it("never exposes invoice content in reported state", async () => {
    const original = Buffer.from(
      JSON.stringify(validInvoice({ invoiceReference: "TOP-SECRET-REF" })),
      "utf-8",
    );
    await srv.handleRequest("POST", "/action", buildAction({ original }));
    const [, body] = await srv.handleRequest("GET", "/state", "");

    expect(JSON.stringify(body)).not.toContain("TOP-SECRET-REF");
    expect(JSON.stringify(body)).not.toContain("Retainer");
  });
});

describe("serialization", () => {
  it("does not wedge the queue when a handler throws", async () => {
    // A rejected handler must not block subsequent requests (contract §5).
    const boom = new Server(0, 0, VERSION, (f) => {
      f.handle("INVOICE", "CREATE", () => {
        throw new Error("boom");
      });
    }, () => ({ ok: true }));

    await expect(
      boom.handleRequest("POST", "/action", buildAction()),
    ).rejects.toThrow("boom");

    // The queue must still be usable.
    const [status] = await boom.handleRequest("GET", "/state", "");
    expect(status).toBe(200);
  });
});
