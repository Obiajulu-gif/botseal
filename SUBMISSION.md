# BotSeal — BOT Chain Builder Challenge #2

**Track: RWA Applications**

Confidential B2B invoices, escrowed and settled in USDT on BOT Chain.

---

## The problem

Trade receivables are one of the largest real-world asset classes there is. Invoice financing,
factoring and escrowed settlement are ordinary business, done at enormous volume, and almost none of
it has moved on-chain.

The reason is not tooling. It is that an invoice is commercially sensitive. It contains unit prices,
the discount you gave this client and not that one, customer identities, tax treatment, payment
terms. Publishing that to get escrow is a trade most businesses will not make, and asking them to is
why "tokenized invoices" keeps stalling at the pilot stage.

BotSeal removes the trade. The commercially sensitive half never reaches the chain; the settlement
half does, and is enforced by a contract.

## What it does

A seller composes an invoice in the browser. Line items, reference, tax and discount detail, and 64
bytes of hiding entropy are encrypted client-side and sent to an attestor, which decrypts,
**recomputes every total from the line items**, derives a commitment binding the private terms, and
signs the settlement facts with EIP-712.

What reaches the chain is only what settlement needs: the two parties, the USD total in cents, the
due date, and a 32-byte commitment. The buyer approves USDT and funds; the contract enforces
release, seller refund, and buyer reclaim after a grace period.

The commitment is what makes the private half provable later — the seller reveals the payload and
anyone can recompute the hash — while remaining impossible to invert, because of the entropy mixed
into it.

## Why this is RWA, not "an app with a database"

- The asset is a **real trade receivable**, not a synthetic.
- Settlement is in **real USDT on BOT Chain mainnet**, not a testnet token.
- The escrow enforces a real **business loop**: issue → fund → release, with refund and expiry
  paths, and the money moves on-chain.
- The confidentiality is what makes the asset **issuable at all** by a business that has commercial
  terms to protect.

---

## Migration disclosure

BotSeal is a port. An earlier version of this project ran on Flare, and the Challenge asks migration
projects three questions.

### Why BOT Chain?

Two concrete reasons, not positioning.

**USDT settlement removed an entire subsystem.** The Flare version denominated invoices in USD cents
but settled in FXRP, a synthetic asset with a floating price. That forced an on-chain oracle read at
funding time, a staleness window, a slippage ceiling the buyer had to choose, a `payable` non-view
quote function, and a UI that had to display how old the price was. BOT Chain has real USDT at 6
decimals. A USD invoice settled in a USD stablecoin needs no oracle, so all of that is gone — and
with it `StalePrice`, `InvalidPrice`, `SlippageExceeded`, and a class of failure where a legitimate
payment reverts because a feed moved.

**The chain is EVM-equivalent enough to port cleanly, and fast enough for the flow.** Cancun opcodes
are supported — verified directly by executing `MCOPY` and `TSTORE`/`TLOAD` as `eth_call` init code
on both 677 and 968, rather than assuming — so OpenZeppelin v5 compiles unmodified.

### What new capabilities does the BOT Chain version add?

| | Flare version | BOT Chain version |
|---|---|---|
| Settlement asset | FXRP (synthetic, floating) | **USDT (real, 1:1 with the invoice's own unit)** |
| Pricing | FTSOv2 oracle read at funding | **None. Amount fixed at issue, exact by construction** |
| Buyer inputs | Slippage ceiling | **Nothing. The contract computes the amount itself** |
| Seller transactions | 2 (instruction + relay) | **1 (relay)** |
| Wait between steps | Indefinite proxy poll | **None** |
| Confidential path infra | Docker Compose, Go tooling, Redis, HTTPS tunnel | **Two serverless route handlers** |
| Signature scheme | Hand-rolled domain separator over opaque bytes | **EIP-712, chain- and contract-bound** |
| Operational surface | ~200 files | **5 files** |

The seller signs one transaction instead of two, because the attestor is reachable directly rather
than through an on-chain instruction and a polling proxy. The confidential payload no longer becomes
a permanent public artifact. And the whole thing deploys as one Next.js app with no container stack.

The port is not a redeployment. `git diff` across the migration branch is **+3,792 / −29,740** over
273 files.

### How will you grow users and on-chain activity?

Honestly: this is at the stage where the product works and has no users, and we would rather say so
than project a curve.

The concrete next steps we can commit to:

1. **A revelation flow.** The commitment exists so a seller can prove terms to a third party — a
   lender, an auditor, a counterparty in a dispute. There is no UI for that yet. It is the single
   feature that turns this from an escrow into something a financier can underwrite against, and it
   is next.
2. **Invoice financing as the actual wedge.** Escrow alone is useful; a receivable a third party can
   verify and buy is a market. The commitment plus a revealed payload is exactly the artifact a
   factor needs.
3. **Distribution through businesses already invoicing in USDT.** Cross-border contractors and
   agencies settle in stablecoins today and reconcile by hand. That is the population with the
   problem, and it does not require convincing anyone to adopt crypto first.
4. **Attested execution.** The confidentiality claim is currently a policy guarantee, not a
   technical one (see below). Closing that is what makes this credible to a business with real
   commercial terms to protect.

---

## Trust model — stated plainly

The attestor is **a server-side signing key we operate.** It is not a TEE. There is no hardware
attestation. **An operator with server access can read invoice plaintext during validation.**

We are stating this prominently rather than burying it, because the alternative is implying a
guarantee the system does not provide.

What the design does guarantee, and what is enforced by the contract rather than by us:

- The plaintext never reaches the chain — only a hash of it does.
- The total is recomputed from the line items before signing. A browser that lies about its own
  arithmetic gets a rejection, not a signature.
- A signed result is single-use, and bound by the EIP-712 domain to one chain and one escrow.
- A compromised attestor key can fabricate invoices nobody is obliged to fund. It **cannot** move
  escrowed funds — funding, release and refund are gated on the buyer and seller addresses, and
  there is no owner path to escrowed USDT.

[docs/SECURITY.md](docs/SECURITY.md) is the full account, including what would have to change.

---

## Submission checklist

| Requirement | Status |
|---|---|
| BOT Chain **mainnet** deployment | ⛔ **pending** — see below |
| Publicly verifiable product with a complete business loop | ✅ issue → fund → release, with refund and expiry paths |
| Wallet connection and core flow | ✅ injected wallet, chain-pinned writes |
| Public website / online demo | ⛔ pending mainnet addresses |
| GitHub repository | ✅ this repo |
| Demo video | ⛔ pending |
| Original development | ✅ ported from our own earlier project, disclosed above |

**Mainnet deployment is the outstanding item.** The contract, the attestor and the frontend are
complete and verified; deployment is blocked only on acquiring mainnet BOT for gas — there is no
mainnet faucet — and USDT for a real demo. The full sequence is scripted and rehearsable on testnet
968 today: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### Addresses

| Contract | Network | Address |
|---|---|---|
| `BotSealEscrow` | BOT Chain 677 | _pending_ |
| USDT (settlement) | BOT Chain 677 | [`0xaBabc7…7a3C`](https://scan.botchain.ai/token/0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C) |

---

## Engineering notes

**Verification.** `make verify` runs everything offline with no chain, wallet or key: 66 contract
tests, 88 frontend tests, lint, typecheck and a production build.

Coverage on `BotSealEscrow.sol`: **100% statements, 100% functions, 100% lines, 85.3% branches.**

**The confidential path was verified live, not just unit-tested.** `web/scripts/check-attestor.mjs`
encrypts a real invoice against a running service and asserts the total was recomputed rather than
trusted, the signature recovers to the advertised address, the attestation id is deterministic
across two submissions, an invalid invoice is refused with 422 naming the rule and never the value,
and a garbage ciphertext fails uniformly so the endpoint cannot be used as a decryption oracle.

**The EIP-712 seam is pinned from both sides.** The web test asserts the exact type string plus a
golden digest generated independently with ethers; the contract test asserts its own
`hashConfidentialInvoice` against the same encoding. A drift there would make every signature
unrelayable and would otherwise only surface at relay time.

**Deployment refuses known-bad configurations.** The script will not deploy against a mainnet token
that does not report `USDT`/6 decimals, and refuses a testnet run pointed at the mainnet USDT
address — on chain 968 that address holds an unrelated 18-decimal token, and using it would
mis-scale every invoice by 10¹².

**No floating point touches a monetary value** in the browser, the attestor, or the contract.
`Number("0.07") * 100` is `7.000000000000001`; there is a test asserting `parseUsdToCents("0.07")`
returns exactly `7n`.

---

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Confidential flow](docs/CONFIDENTIAL_FLOW.md) ·
[Security](docs/SECURITY.md) · [Deployment](docs/DEPLOYMENT.md) · [Demo runbook](docs/DEMO_RUNBOOK.md) ·
[Migration plan](MIGRATION_PLAN.md)
