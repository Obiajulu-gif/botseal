# FCC flow

The exact mechanics of a confidential invoice, from browser entropy to a verified on-chain record.

Every wire shape below was taken from the running scaffold — `fcc/tools/pkg/fccutils/tee_calls.go`
and the `tee-node` `pkg/types` package — not from documentation prose.

---

## 1. Encryption

**Source of the scheme.** `fcc/tools/pkg/utils/invoice.go` encrypts with go-ethereum's ECIES:

```go
pub := &ecies.PublicKey{X: ..., Y: ..., Curve: ecies.DefaultCurve, Params: ecies.ECIES_AES128_SHA256}
ciphertext, err := ecies.Encrypt(rand.Reader, pub, plaintext, nil, nil)
```

The browser uses [`ecies-geth`](https://www.npmjs.com/package/ecies-geth), the JavaScript port of
that same implementation (secp256k1, AES-128-CTR, HMAC-SHA256). No cryptography is hand-written in
this project — see `web/lib/fcc.ts` → `encryptToTee`.

**Recipient key.** `GET /info` returns the TEE's public key as two 32-byte coordinates:

```json
{ "teeInfo": { "publicKey": { "x": "0x…", "y": "0x…" }, "chainId": 114 } }
```

`publicKeyFromInfo` zero-pads each coordinate to exactly 32 bytes and concatenates them into an
uncompressed key, `0x04 || X || Y`. The padding matters: a coordinate with leading zero bytes is
often serialised short, and an unpadded key silently encrypts to the wrong point.

**Plaintext.** The JSON the extension validates:

```json
{
  "version": 1,
  "seller": "0x…", "buyer": "0x…", "escrowContract": "0x…",
  "invoiceReference": "INV-2026-014",
  "dueAt": 1793491199,
  "currency": "USD",
  "items": [{ "description": "…", "quantity": "2", "unitPriceCents": "125000" }],
  "discountCents": "0", "taxCents": "0",
  "nonce": "<32 random bytes, hex>",
  "salt":  "<32 random bytes, hex>"
}
```

Numeric fields are **decimal strings**, so JSON parsing cannot round them. `nonce` and `salt` come
from `crypto.getRandomValues(new Uint8Array(32))`.

---

## 2. Instruction transaction

```solidity
function sendCreateInvoice(bytes calldata _encryptedPayload)
    external payable returns (bytes32 instructionId);
```

The contract rejects empty ciphertext, resolves one random TEE id for its extension, uses zero
cosigners, and sets `claimBackAddress = msg.sender`.

**The fee** is `msg.value`. It is not invented anywhere in this codebase: the frontend forwards
`NEXT_PUBLIC_FCC_INSTRUCTION_FEE_WEI`, which the operator copies from whatever the scaffold's own
deployment path uses against the live registry. Unset means zero, which is correct for the current
Coston2 registry.

---

## 3. Action id extraction

```solidity
event ConfidentialInvoiceRequested(bytes32 indexed actionId, address indexed requester);
```

The browser decodes the receipt logs and takes `actionId`. Foreign logs — the registry emits its own
— fail to decode against the InstructionSender ABI and are skipped. If no matching event is present,
the flow stops with `instruction-failed` rather than polling for an id that does not exist.

---

## 4. Polling

```
GET <proxy>/action/result/<actionId>
```

Proxied through `web/app/api/fcc/result/[actionId]/route.ts` so the tunnel URL stays server-side.

Response (`types.ActionResponse`):

```json
{
  "result": {
    "id": "0x…",
    "submissionTag": "end",
    "status": 1,
    "log": "",
    "opType": "0x…", "opCommand": "0x…",
    "version": "0.1.0",
    "data": "0x…"
  },
  "signature": "0x… (65 bytes)",
  "proxySignature": "0x…"
}
```

| `status` | Meaning | Client behaviour |
|---|---|---|
| `2` | Still queued | Keep polling |
| `1` | Success | Stop, relay |
| `0` | TEE rejected the invoice | Stop, show `result.log` |

The route maps a 404/425 upstream to a 202 so "not ready" is never mistaken for failure. The client
polls on `NEXT_PUBLIC_FCC_POLL_INTERVAL_MS` with an `AbortController`, stops on unmount, and gives
up after `NEXT_PUBLIC_FCC_RESULT_TIMEOUT_MS`.

`normaliseFccResponse` refuses to report success unless `data` is non-empty hex **and** the
signature is exactly 65 bytes.

---

## 5. Result data

The extension ABI-encodes a flat parameter list — not a tuple:

```solidity
abi.encode(
    address seller,
    address buyer,
    address escrowContract,
    uint256 usdAmountCents,
    uint64  dueAt,
    bytes32 termsCommitment
)
```

The escrow decodes with the identical schema. Nothing private appears here: no reference, no
descriptions, no nonce, no salt.

### Commitment construction

Per item, in submission order:

```
itemHash = keccak256(abi.encode(keccak256(description), quantity, unitPriceCents, lineTotal))
itemsHash = keccak256(itemHash[0] ‖ itemHash[1] ‖ …)
```

Then:

```
termsCommitment = keccak256(abi.encode(
    keccak256("FLARESEAL_INVOICE_V1"),
    seller, buyer, escrowContract,
    keccak256(invoiceReference),
    itemsHash,
    discountCents, taxCents, finalTotalCents,
    uint64(dueAt),
    keccak256(nonce), keccak256(salt)
))
```

Deterministic (same normalised inputs → same hash, which the extension's tests assert) and hiding
(64 bytes of entropy).

Totals are computed with `bigint` only:

```
lineTotal  = quantity × unitPriceCents
subtotal   = Σ lineTotal
finalTotal = subtotal − discountCents + taxCents
```

---

## 6. Signature construction

The TEE signs `ActionResult.Hash()`, defined in tee-node as:

```go
keccak256( keccak256(data) ‖ id ‖ keccak256(submissionTag) ‖ status )
```

The escrow reconstructs exactly that, then applies Flare's domain separation and the EIP-191
wrapper:

```solidity
bytes32 resultHash = keccak256(abi.encodePacked(
    keccak256(resultData), actionId, keccak256(bytes(submissionTag)), status
));

bytes32 payloadHash = keccak256(abi.encode(
    TEE_ACTION_RESULT_PREFIX,   // bytes32("TEE_ACTION_RESULT")
    block.chainid,              // binds the signature to this chain
    resultHash
));

address recovered = ECDSA.recover(
    MessageHashUtils.toEthSignedMessageHash(payloadHash), signature
);
if (recovered != teeAddress) revert InvalidTeeSignature();
```

`abi.encodePacked` for the inner hash and `abi.encode` for the outer one is not a stylistic choice —
it mirrors the Go implementation byte for byte.

**`resultData` is hashed exactly as received.** It is never decoded and re-encoded before
verification; the decode happens only *after* the signature checks out. Re-encoding would change
`keccak256(resultData)` and the recovery would yield a different address.

---

## 7. Replay protection

```solidity
if (consumedFccActionIds[actionId]) revert FccActionAlreadyConsumed();
…
consumedFccActionIds[actionId] = true;
```

Each `actionId` is single-use for the contract's lifetime. The flag is set before invoice creation,
and because the whole call is atomic, a revert anywhere later leaves the id unconsumed — there is a
contract test asserting exactly that.

---

## 8. Relay

```solidity
function relayConfidentialInvoice(
    bytes calldata resultData,
    bytes32 actionId,
    string calldata submissionTag,
    uint8 status,
    bytes calldata signature
) external whenNotPaused returns (uint256 invoiceId);
```

Checks, in order:

1. `teeAddress` configured — else `TeeNotConfigured`
2. `status == 1` — else `TeeReportedFailure`
3. `actionId != 0` — else `InvalidActionId`
4. Not already consumed — else `FccActionAlreadyConsumed`
5. Signature recovers to `teeAddress` — else `InvalidTeeSignature`
6. Decode `resultData`
7. `escrowContract == address(this)` — else `ResultForWrongContract`
8. `seller == msg.sender` — else `InvalidResultSeller`
9. Buyer, amount, due date, commitment validated in `_createInvoice`

Steps 7 and 8 are what stop a result being replayed into a different deployment, or relayed by
someone other than the seller it names.

The frontend passes all five values through untouched, in that order
(`web/hooks/use-confidential-invoice.ts`), then reads `InvoiceCreated` from the receipt for the new
invoice id.
