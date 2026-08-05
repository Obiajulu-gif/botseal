# Security

An honest account of what FlareSeal protects, what it does not, and what would have to be true
before it could hold real money.

---

## Encrypted on-chain is not permanent privacy

The ECIES ciphertext is written to a public, immutable ledger. Encryption is a **time-bounded**
guarantee: it protects against adversaries with today's compute and today's cryptanalysis. Anyone
can retain the ciphertext forever and attack it later.

Concretely, this means:

- Invoice contents are confidential **today** against anyone without the TEE's private key.
- They are not confidential against a future adversary who breaks secp256k1 or AES-128, or who
  extracts the TEE key.
- "Harvest now, decrypt later" applies. Do not put anything in a FlareSeal invoice that must stay
  secret for decades.

A construction with stronger long-term properties would keep the ciphertext off-chain entirely and
publish only the commitment. FlareSeal deliberately does not, because the on-chain payload is what
makes the flow auditable end to end.

---

## The TEE is simulated

The local stack runs the extension in a **simulated** enclave against live Coston2. There is no
hardware attestation, so:

- A local operator can, in principle, read decrypted invoices.
- The "TEE key" is a key held by a process on a normal machine.
- The code-hash attestation that would prove *which* code is running is absent.

Production FCC requires a real Confidential Space VM with code-hash attestation and reproducible
builds. Until then, the confidentiality claim is architectural, not enforced. This is the single
largest gap between this build and something deployable.

---

## TEE signer administration

The escrow verifies against exactly one address, `teeAddress`, set by the owner.

**Risk.** Whoever controls the owner key controls which signer the escrow trusts. A malicious or
compromised owner can point it at a key they hold and mint invoices with arbitrary totals and
commitments.

**Bounded by.** A rogue signer still cannot move money:

- `fundInvoice` requires `msg.sender == invoice.buyer`.
- `releasePayment` requires the buyer.
- `refundBuyer` requires the seller.
- There is **no owner path to escrowed FXRP** — `recoverUnsupportedToken` reverts with
  `CannotRecoverEscrowToken` for the FXRP address.

So the worst case is fabricated invoices that no buyer is obliged to fund, not theft.

**Mitigations for production.** Put the owner behind a multisig or timelock, and emit/monitor
`TeeAddressUpdated`. Rotating the address does not invalidate existing invoices, which is
deliberate — settlement of past invoices must not depend on current signer configuration.

---

## Price freshness

`fundInvoice` reads FTSOv2 on-chain at funding time and rejects:

| Condition | Error |
|---|---|
| `priceWei == 0` | `InvalidPrice` |
| `timestamp > block.timestamp` | `InvalidPrice` |
| `block.timestamp − timestamp > maxPriceAge` | `StalePrice` |

`maxPriceAge` is immutable, validated at construction to be non-zero and at most 24 hours. A stale
feed makes funding fail rather than settle at a wrong price.

The frontend never supplies a price. It displays one from a **simulation** of the contract's own
`quoteInvoice`, and the contract re-reads the feed independently.

---

## Slippage

The only pricing input the buyer contributes is `maxFxrpAmount`:

```
maxFxrpAmount = ceil(quoted × (10000 + slippageBps) / 10000)
```

If the freshly computed requirement exceeds it, the transaction reverts with `SlippageExceeded`.
This can only cause a failure, never an overpayment. Rounding is up so the ceiling is never a unit
short of a legitimate quote.

---

## Integer arithmetic

No floating point touches a monetary value anywhere:

- **Browser** — `parseUsdToCents` parses the decimal string by hand. `Number("0.07") * 100` is
  `7.000000000000001`; there is a test asserting `parseUsdToCents("0.07") === 7n`. More than two
  decimal places is rejected, not rounded.
- **Extension** — `bigint` only, with amounts arriving as decimal strings so JSON cannot round them.
- **Contract** — `uint256` with `Math.mulDiv(..., Math.Rounding.Ceil)`, which computes the full
  512-bit intermediate product and cannot overflow on the multiply.

Rounding is consistently **up** at the cents → token-units boundary, so the escrow is never
under-funded by truncation.

---

## ERC-20 allowance risk

The frontend approves the **exact** slippage-adjusted amount and never requests unlimited approval.
Residual allowance after funding is therefore at most the slippage buffer, and only the escrow can
spend it.

Standard caveats still apply: an approval is a standing authorisation until spent or revoked, and a
buyer who abandons a payment mid-flow leaves a small allowance in place. All token movement uses
`SafeERC20`, so a non-standard token that returns `false` instead of reverting is still caught.

---

## Escrow state transitions

Every state-changing function:

1. Loads the invoice and rejects `None` (`InvoiceNotFound`).
2. Requires an exact expected status — not "anything but X".
3. Checks the caller against the specific role.
4. **Writes state before transferring tokens.**
5. Is `nonReentrant` where tokens move.
6. Is `whenNotPaused`.

Checks-effects-interactions is applied literally: in `fundInvoice`, `releasePayment`, `refundBuyer`,
and `claimExpiredRefund`, status and `totalEscrowed` are updated and the event emitted *before*
`safeTransfer`/`safeTransferFrom`. A reentrant callback would find the invoice already in its
terminal state.

`claimExpiredRefund` additionally requires `block.timestamp > dueAt + refundGracePeriod`, so a
seller who delivered late still has a bounded window to be paid.

---

## No owner withdrawal path

There is no function by which the owner can move escrowed FXRP. `recoverUnsupportedToken` exists for
tokens accidentally sent to the contract and explicitly reverts for FXRP. `pause` can halt new
activity but cannot redirect funds — and note that pausing **does** block release and refund, so a
malicious owner could freeze settlement. That is a griefing vector, not a theft vector, and is
another reason to put the owner behind a multisig.

---

## Data handling in the frontend

- The plaintext payload exists only as a local `const` inside the creation function. It is never
  placed in React state, `localStorage`, a URL, a toast, or an error report.
- `nonce` and `salt` are generated inside the payload builder and dropped with it.
- Form state is reset after a successful creation.
- The FCC proxy URL is server-only; the browser talks to `/api/fcc/*`.
- `/api/fcc/info` returns only the public key, derived TEE address, extension id, and chain id — the
  attestation document, machine data, and proxy signature are withheld.
- Error messages name a field and a rule. The extension's rejection strings never echo a submitted
  value, so surfacing `result.log` in the UI cannot leak invoice content.

---

## Remaining work before this could hold real value

1. **Third-party audit** of `FlareSealEscrow.sol` and the extension handler.
2. **Real attested TEE** on Confidential Space with verified code-hash and reproducible builds.
3. **Owner hardening** — multisig or timelock, with monitoring on `TeeAddressUpdated` and `Paused`.
4. **Signer rotation policy** — documented procedure and key custody.
5. **FTSOv2 parameter review** — is 600s the right `maxPriceAge` for XRP's volatility?
6. **Griefing review** — the pause-blocks-settlement path above.
7. **Formal verification** of the state machine and the cents → token-units conversion.
8. **Front-running review** — invoice creation is not order-sensitive, but funding at a moving price
   deserves analysis.
9. **Commitment revelation UX** — there is currently no in-app way for a seller to prove terms to a
   third party by revealing the payload.
