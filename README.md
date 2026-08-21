# BotSeal

Confidential invoices, settled in **USDT on BOT Chain**.

A B2B invoice contains things neither party wants public: line items, unit prices, customer
identities, tax treatment, the discount you gave this client and not that one. Putting that on a
public ledger to get escrow is a bad trade. BotSeal doesn't make you take it.

Line items, references, tax detail and the commitment's entropy are encrypted in the browser and
validated off-chain. What reaches the chain is the minimum settlement needs: the two parties, the
USD total, the due date, and a 32-byte commitment binding the private terms. Payment is escrowed in
USDT and released, refunded or reclaimed by rules the contract enforces.

> **Provenance.** BotSeal is a port of an earlier project of ours that ran on Flare. The BOT Chain
> version is not a redeployment: the price oracle is gone, settlement moved to USDT, the
> confidential path was rebuilt, and the seller signs one transaction instead of two. See
> [SUBMISSION.md](SUBMISSION.md) for what specifically changed and why.

---

## Architecture

```
Browser                          Attestor (server)              Chain (BOT Chain)
───────                          ─────────────────              ─────────────────
invoice form
   │
   ├─ ECIES-encrypt to attestor key
   │
   └─ POST /api/attestor/create ──▶ decrypt
                                    validate every field
                                    recompute total (bigint cents)
                                    derive termsCommitment
                                    sign EIP-712
   ┌──────── attestation + signature ◀┘
   │
   └─ relayConfidentialInvoice(attestation, signature) ──▶ BotSealEscrow
                                                             │ verify EIP-712 signature
                                                             │ reject replayed attestationId
                                                             └─ Invoice { Pending, confidential }

buyer ─ approve USDT ─▶ fundInvoice ─▶ escrow holds USDT
                          releasePayment / refundBuyer / claimExpiredRefund
```

| Component | Path | Stack |
|---|---|---|
| Escrow contract | `contracts/` | Solidity 0.8.27, Hardhat, OpenZeppelin v5 |
| Attestor service | `web/app/api/attestor/`, `web/lib/attestor/` | Next.js route handlers, viem, ecies-geth |
| Frontend | `web/` | Next.js 15 App Router, wagmi + viem, Tailwind |

Detailed docs: [Architecture](docs/ARCHITECTURE.md) · [Confidential flow](docs/CONFIDENTIAL_FLOW.md) ·
[Security](docs/SECURITY.md) · [Deployment](docs/DEPLOYMENT.md) · [Demo runbook](docs/DEMO_RUNBOOK.md)

---

## What the attestor is, and is not

The attestor is **a server-side signing key that we operate.** It is not a trusted execution
environment, there is no hardware attestation, and an operator with server access can read invoice
plaintext while it is being validated.

What the design does guarantee:

- The plaintext never reaches the chain — only a hash of it does.
- The commitment binds the private terms, so a seller can prove later exactly what was invoiced.
- The total is recomputed from the line items before it is signed. A browser that lies about its
  own arithmetic gets a rejection, not a signature.
- A signed result is single-use and bound to one chain and one escrow contract.

What it does not guarantee: that we cannot read your invoice. If that matters to you, this is not
yet the right tool. [docs/SECURITY.md](docs/SECURITY.md) is explicit about the gap and what would
have to change.

---

## Required software

| Tool | Version | Needed for |
|---|---|---|
| Node.js | ≥ 20 | contracts, frontend, attestor |
| npm | ≥ 10 | package management |

No Docker, no Go, no tunnel, no container stack. The confidential path runs inside the Next.js app.

---

## Networks

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 677 | 968 |
| RPC | `https://rpc.botchain.ai` | `https://rpc.bohr.life` |
| Explorer | `https://scan.botchain.ai` | `https://scan.bohr.life` |
| Native token | BOT | tBOT — [faucet](https://faucet.botchain.ai) |
| Settlement token | USDT `0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C` (6 dec) | deploy a 6-decimal `MockERC20` |

There is **no mainnet faucet**. Mainnet BOT has to be acquired before deploying.

The demo needs **two** addresses — a seller and a buyer. The escrow rejects an invoice where they
match. Import a second account in your wallet's own UI; never share or generate a mnemonic through
this project.

---

## Install

```bash
make install
```

Check what configuration is still missing at any point:

```bash
node scripts/check-env.mjs
```

---

## Contract tests

```bash
cd contracts && npm test
```

Coverage:

```bash
cd contracts && npm run coverage
```

---

## Deploy

Full sequence with every variable explained: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). In short:

```bash
cp contracts/.env.example contracts/.env
```

Fill in `DEPLOYER_PRIVATE_KEY` with a **funded key you control**. It is read only from the
environment and is gitignored.

Rehearse on testnet first — it costs nothing and catches everything except gas price:

```bash
cd contracts && npm run deploy:testnet
```

Then mainnet:

```bash
cd contracts && npm run deploy:botchain
```

The deploy script refuses to proceed against a mainnet token that does not report `USDT`/6
decimals, and refuses a testnet run pointed at the mainnet USDT address — that address holds an
unrelated 18-decimal token on chain 968, and using it would mis-scale every invoice by 10¹².

Read-only verification of whatever is deployed, no key required:

```bash
cd contracts && npm run smoke:botchain
```

---

## Attestor

```bash
cp web/.env.example web/.env.local
```

`ATTESTOR_PRIVATE_KEY` is the signing key the escrow will verify against. Generate it in your own
wallet tooling, put it in the host's secret store, and rotate it after any public demo. It must
never be prefixed `NEXT_PUBLIC_` — that would inline it into the browser bundle. `lib/attestor/signer.ts`
imports `server-only`, so an accidental client import is a build error rather than a leak.

Point the escrow at the attestor's address:

```bash
cd contracts && npm run configure-attestor:botchain
```

Verify the running service end to end — encrypts a real invoice, checks the total was recomputed,
the signature recovers to the advertised address, an invalid invoice is refused and a garbage
ciphertext fails without revealing why:

```bash
cd web && npm run check-attestor
```

---

## Frontend

```bash
make sync-abi
cd web && npm run dev
```

---

## Verify everything offline

```bash
make verify
```

Runs the contract suite, then the frontend's lint, typecheck, unit tests and production build. No
chain, wallet or key required.

---

## Deployed addresses

Live on **BOT Chain Testnet (chain 968)**. Full record in `contracts/deployments/botchain-968.json`.

| Contract | Address |
|---|---|
| `BotSealEscrow` | [`0x926A0215BC58c4897c5604a7E5eeCf5D4d84cc1D`](https://scan.bohr.life/address/0x926A0215BC58c4897c5604a7E5eeCf5D4d84cc1D) |
| USDT (test settlement token, 6d) | [`0x358A95Aa014D112CDFbEe5f3eA599BA14B331CBF`](https://scan.bohr.life/address/0x358A95Aa014D112CDFbEe5f3eA599BA14B331CBF) |
| Attestor signer | [`0x1399edE7cE143bE5D463471Fa5D09CB8996eB818`](https://scan.bohr.life/address/0x1399edE7cE143bE5D463471Fa5D09CB8996eB818) |

A full confidential invoice was created, funded and settled on chain against this deployment:

| Step | Transaction |
|---|---|
| Escrow deployment | [`0x3030e64f…331f16`](https://scan.bohr.life/tx/0x3030e64ff56bf820b2192a582dd1c74ead9e78f37b1e1a1dba4619b058331f16) |
| Attestor configured | [`0x5b483407…e9e42b`](https://scan.bohr.life/tx/0x5b483407e08e65a8a68f9695e24a835aa8e6c16e94d27285c1dac2e7c2e9e42b) |
| Confidential relay | [`0xaa609e39…a6cfaa`](https://scan.bohr.life/tx/0xaa609e39b4f4565aa2e0468535ce022f5d619af461c90632762ecf5a20a6cfaa) |
| Funded ($2,510.22) | [`0x5fab4d98…ae0063`](https://scan.bohr.life/tx/0x5fab4d9826eb2a34f80db31cb63520fd8d79ba6a1aef1b63faf113296bae0063) |
| Released to seller | [`0xedf7ecd2…e225e9`](https://scan.bohr.life/tx/0xedf7ecd22885b4e2d3641179ed4ad22c10d75d7985b981ab97acbda46de225e9) |

The relay carried 356 bytes of calldata and no invoice plaintext. Reproduce with
`npm run smoke-live:testnet`.

Mainnet (chain 677) is configured but nothing is deployed there. It settles in real USDT
[`0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C`](https://scan.botchain.ai/token/0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C).

---

## Known limitations

- **The attestor is a server key, not a TEE.** No hardware attestation. An operator can read
  plaintext during validation. This is the largest gap between this build and something that should
  hold real money.
- **Encrypted, not eternally private.** The ciphertext is transmitted to a server we run; the
  commitment is public and permanent. Nothing here is safe against an adversary with decades.
- **Unaudited.** No third-party security review.
- **Public fallback is unverified.** `createPublicInvoice` accepts a caller-supplied commitment that
  nobody validated. It exists for demo continuity, is off unless
  `NEXT_PUBLIC_ENABLE_PUBLIC_MODE=true`, and the UI labels every invoice created this way.
- **Owner can pause settlement.** `pause()` blocks release and refund as well as creation. That is a
  griefing vector, and a reason to put the owner behind a multisig before real value is involved.
- **Injected wallets only.** WalletConnect needs an external project id; the frontend uses the
  injected connector so it runs with no external accounts.
