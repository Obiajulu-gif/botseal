# Architecture

## Components

| Component | Runs where | Trusted for |
|---|---|---|
| Browser app (`web/`) | User's device | Generating entropy, encrypting, holding plaintext transiently |
| `FlareSealInstructionSender` (`fcc/contracts/`) | Coston2 | Forwarding ciphertext to the TEE registry |
| FCC extension (`fcc/typescript/`) | TEE (simulated locally) | Decrypting, validating, computing totals, signing |
| `FlareSealEscrow` (`contracts/`) | Coston2 | Signature verification, replay protection, custody, pricing |
| FTSOv2 | Coston2 | XRP/USD price |
| FXRP | Coston2 | Settlement asset |

## Trust boundaries

```
┌─ User's device ─────────────────┐
│  plaintext invoice              │  ← never leaves except as ciphertext
│  nonce, salt (32 bytes each)    │
└───────────┬─────────────────────┘
            │ ECIES to the TEE public key
┌───────────▼─────────────────────┐
│  Public chain                   │  ← ciphertext is visible and permanent
│  ciphertext, totals, commitment │
└───────────┬─────────────────────┘
            │ registry dispatch
┌───────────▼─────────────────────┐
│  TEE enclave                    │  ← only place plaintext is readable after encryption
│  decrypt, validate, sign        │
└─────────────────────────────────┘
```

Three parties are trusted with distinct things, and none of them with everything:

- The **browser** sees plaintext, but it is the user's own device.
- The **chain** sees ciphertext and the public result, never the terms.
- The **TEE** sees plaintext but cannot move funds — it only signs a result. The escrow decides
  what that signature is worth.

The escrow trusts exactly one key: `teeAddress`. Compromising it lets an attacker mint invoices
with arbitrary totals, but still not touch escrowed FXRP — funding, release, and refund are gated on
the buyer and seller addresses, not on the TEE.

## On-chain versus private

| Field | On-chain | Private |
|---|---|---|
| Seller, buyer | ✅ | |
| USD total (cents) | ✅ | |
| Due date | ✅ | |
| Terms commitment | ✅ | |
| FCC action id | ✅ | |
| FXRP amount, funding price | ✅ (after funding) | |
| Line item descriptions | | ✅ |
| Quantities, unit prices | | ✅ |
| Invoice reference | | ✅ |
| Tax and discount breakdown | | ✅ (only the net total is public) |
| Nonce, salt | | ✅ |

The commitment is what makes the private half provable later: the seller can reveal the payload and
anyone can recompute the hash. Because it mixes in 32 bytes of nonce and 32 of salt, it cannot be
brute-forced back to the line items even for a small invoice.

## Interaction sequence

```
Seller browser        InstructionSender     TEE extension      Escrow
     │                        │                   │               │
     │─ GET /api/fcc/info ────┼───────────────────▶               │
     │◀── publicKey ──────────┼───────────────────┤               │
     │                        │                   │               │
     │─ encrypt(payload) ─────│                   │               │
     │─ sendCreateInvoice ───▶│                   │               │
     │                        │─ registry ───────▶│               │
     │                        │                   │ decrypt       │
     │                        │                   │ validate      │
     │                        │                   │ commitment    │
     │◀─ poll /action/result ─┼───────────────────┤ sign          │
     │                        │                   │               │
     │─ relayConfidentialInvoice(exact bytes) ────┼──────────────▶│
     │                        │                   │        verify sig
     │                        │                   │        consume actionId
     │                        │                   │        create Invoice
     │                        │                   │               │
Buyer browser                                                     │
     │─ simulate quoteInvoice ─────────────────────────────────────▶ FTSOv2
     │─ approve(FXRP, maxAmount) ─────────────────────────────────▶│
     │─ fundInvoice(id, maxAmount) ───────────────────────────────▶│ reads FTSOv2 again
     │─ releasePayment(id) ───────────────────────────────────────▶│ transfers to seller
```

## Price and unit math

Everything is integer arithmetic. There is no floating point in the browser, the extension, or the
contract.

**Cents to token units**, in `FlareSealEscrow._usdCentsToFxrp`:

```
usdValueWei  = usdAmountCents × 1e16          // cents → 18-decimal USD
requiredFxrp = ceil(usdValueWei × 10^dec / xrpUsdPriceWei)
```

`10^dec` is `fxrpScale`, cached at construction from `FXRP.decimals()` — so a token that later
changes its reported decimals cannot re-price existing invoices. Rounding is **up**, so truncation
can never leave the escrow short.

Worked example with the real Coston2 FXRP (6 decimals):

| Invoice | XRP/USD | Required FXRP |
|---|---|---|
| $100.00 (10 000 cents) | $0.50 | 200.000000 |
| $100.00 | $2.00 | 50.000000 |
| $0.01 (1 cent) | $3.00 | 0.003334 (rounded up from 0.003333…) |

**Freshness.** `_readXrpUsdPrice` rejects a zero price, a timestamp in the future, and any
observation older than `maxPriceAge` (600s by default, capped at 24h at construction).

**Slippage.** The browser computes a ceiling and passes it as `maxFxrpAmount`:

```
maxFxrpAmount = ceil(quoted × (10000 + slippageBps) / 10000)
```

This is the only number the frontend contributes to pricing, and it can only make a transaction
fail — never make it cost more. `fundInvoice` re-reads FTSOv2 on-chain and transfers exactly what it
computes itself.

## Invoice state machine

```
        createPublicInvoice
        relayConfidentialInvoice
                 │
                 ▼
             ┌────────┐  cancelInvoice (seller)   ┌───────────┐
             │Pending │──────────────────────────▶│ Cancelled │
             └───┬────┘                           └───────────┘
                 │ fundInvoice (buyer, before dueAt)
                 ▼
             ┌────────┐  releasePayment (buyer)   ┌──────────┐
             │ Funded │──────────────────────────▶│ Released │
             └───┬────┘                           └──────────┘
                 │ refundBuyer (seller)
                 │ claimExpiredRefund (buyer, after dueAt + grace)
                 ▼
             ┌──────────┐
             │ Refunded │
             └──────────┘
```

Released, Refunded, and Cancelled are terminal. Every transition sets state before transferring
tokens, and every token-moving function is `nonReentrant`.
