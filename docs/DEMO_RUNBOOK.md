# Demo runbook

Deterministic order, exact commands. Total time ~10 minutes once deployed.

---

## Before the demo

Two wallet accounts, both on Coston2:

| Role | Needs |
|---|---|
| **Seller** | C2FLR for gas |
| **Buyer** | C2FLR for gas **and** test FXRP |

Both from <https://faucet.flare.network>. They must be different addresses — the escrow reverts with
`SameSellerAndBuyer` otherwise.

Pre-flight:

```bash
node scripts/check-env.mjs
```

```bash
node scripts/smoke-coston2.mjs
```

```bash
curl -s $FCC_PROXY_URL/info | jq '.teeInfo.publicKey.x'
```

If the third command fails, the tunnel is down — restart it and update `FCC_PROXY_URL`. Have the
[fallback](#if-fcc-is-down) ready.

Start the app:

```bash
cd web && npm run build && npm run start
```

---

## Act 1 — Create a confidential invoice (seller)

1. Open `http://localhost:3000`, connect the **seller** wallet. Header shows a green **Coston2**
   badge and the deployment panel shows all three addresses.

2. **New invoice**. Fill in:

   | Field | Value |
   |---|---|
   | Buyer | the buyer address |
   | Reference | `INV-2026-014` |
   | Due date | ~30 days out |
   | Item 1 | `Design retainer, March` · qty `2` · `1250.00` |
   | Item 2 | `Hosting, Q1` · qty `3` · `19.99` |
   | Tax | `50.25` |
   | Discount | `100.00` |

   The totals panel shows **$2,510.22** and `251022 cents`, computed as
   `255997 − 10000 + 5025`. Point out that it is integer arithmetic — the panel prints the raw cent
   count.

3. **Create private invoice**. The progress panel walks the state machine:

   ```
   loading-extension-info → encrypting → awaiting-wallet-signature
   → submitting-instruction → waiting-for-result → relaying-result → confirmed
   ```

   Two wallet confirmations: the instruction, then the relay. The TEE step normally takes 10–30s.

4. You land on the invoice detail page.

**The point to make:** open the instruction transaction on the explorer. The calldata is opaque
ciphertext. No description, no reference, no quantities. Then open the escrow storage: seller, buyer,
`251022`, due date, and a 32-byte commitment.

---

## Act 2 — Fund and settle (buyer)

5. Switch to the **buyer** wallet. Dashboard shows the invoice with a **Buyer** badge.

6. Open it, click **Fund this invoice** (or go to `/pay/<id>`). The page shows:

   - Required FXRP, from a simulation of the contract's own `quoteInvoice`
   - The live XRP/USD price and how old the observation is
   - Your FXRP balance and current allowance

7. Pick a slippage tolerance (1% is the default). The page shows the exact ceiling that will be
   authorised.

8. **Approve FXRP** — note it approves the exact amount, not unlimited.

9. **Fund escrow**. The contract re-reads FTSOv2 and transfers exactly what it computes.

10. **Release payment to seller**. Status → **Released**.

11. Confirm the seller's FXRP balance increased, in the wallet or the explorer.

---

## Talking points

**Privacy is structural, not promised.** The escrow has no field for a description. There is no
"private" flag to get wrong — the data was never submitted.

**The TEE is authoritative, not trusted with money.** It validates and signs; the escrow verifies
the signature, rejects replays, and enforces who may fund, release, and refund. A compromised TEE
key can fabricate invoices nobody has to pay — it cannot move escrowed FXRP.

**The price is never client-supplied.** The buyer contributes only a ceiling, which can make funding
fail but never cost more.

**Replay is prevented on-chain.** Relay the same result twice and it reverts with
`FccActionAlreadyConsumed`. There is a contract test for it, and for the fact that a *failed* relay
does not consume the id.

---

## If FCC is down

Level-2 fallback (see README, §Known limitations):

1. Show the already-recorded confidential transactions from `BUILD_REPORT.md` — the confidential
   path demonstrably worked.
2. Set `NEXT_PUBLIC_ENABLE_PUBLIC_MODE=true`, restart the frontend.
3. Use **Create public fallback invoice**. Every such invoice is labelled **Public fallback** in the
   UI and its FCC action id is empty.
4. The FXRP and FTSOv2 half of the demo — quote, approve, fund, release — is unaffected and real.

Say plainly that the confidential path is the point and this is a continuity measure. Do not present
a public invoice as a confidential one.

---

## Reset between runs

Invoices are append-only; nothing needs resetting. For a clean dashboard use a fresh seller address,
or note that `nextInvoiceId` keeps counting.

```bash
cd fcc && ./scripts/stop-services.sh
```
