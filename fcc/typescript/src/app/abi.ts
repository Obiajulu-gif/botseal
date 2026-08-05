/**
 * ★ ABI encoding for the public FCC result.
 *
 * The bytes produced here are what tee-node signs and what the frontend relays verbatim into
 * `FlareSealEscrow.relayConfidentialInvoice`. The schema must stay byte-identical to the
 * `abi.decode` in that function:
 *
 *   (address seller, address buyer, address escrowContract,
 *    uint256 usdAmountCents, uint64 dueAt, bytes32 termsCommitment)
 *
 * Note this is a flat parameter list, NOT a tuple - `abi.encode(a, b, c, ...)` on the Solidity
 * side, not `abi.encode(struct)`. Wrapping it in a tuple would add an offset word and the escrow
 * would decode garbage.
 */

import { encodeAbiParameters, type Hex } from "viem";

export const INVOICE_RESULT_PARAMS = [
  { name: "seller", type: "address" },
  { name: "buyer", type: "address" },
  { name: "escrowContract", type: "address" },
  { name: "usdAmountCents", type: "uint256" },
  { name: "dueAt", type: "uint64" },
  { name: "termsCommitment", type: "bytes32" },
] as const;

export interface InvoiceResult {
  seller: Hex;
  buyer: Hex;
  escrowContract: Hex;
  usdAmountCents: bigint;
  dueAt: bigint;
  termsCommitment: Hex;
}

export function encodeInvoiceResult(result: InvoiceResult): Hex {
  return encodeAbiParameters(INVOICE_RESULT_PARAMS, [
    result.seller,
    result.buyer,
    result.escrowContract,
    result.usdAmountCents,
    result.dueAt,
    result.termsCommitment,
  ]);
}
