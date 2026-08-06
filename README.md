# FlareSeal

**Live app: https://flareseal.vercel.app**

Confidential invoice creation and FXRP escrow on **Flare Testnet Coston2**.

Invoice line items, customer identities, tax details, and the commitment's entropy are encrypted in
the browser and validated inside a **Flare Confidential Compute (FCC)** TEE. What reaches the chain
is the minimum settlement needs: the parties, the USD total, the due date, and a 32-byte commitment
binding the private terms. Payment is escrowed in **FXRP**, priced on-chain from the **FTSOv2**
XRP/USD feed.

---

## Architecture

```
Browser                      Chain (Coston2)                 TEE (FCC extension)
───────                      ───────────────                 ───────────────────
invoice form
   │
   ├─ ECIES-encrypt to TEE key
   │
   └─ sendCreateInvoice(ciphertext) ──> FlareSealInstructionSender
                                              │
                                              └─ registry ──────> INVOICE/CREATE
                                                                     │ decrypt
                                                                     │ validate
                                                                     │ total (bigint cents)
                                                                     │ termsCommitment
                                                                     ▼
                                                          ActionResult (TEE-signed)
   ┌──────────── poll /action/result/<id> ◀───────────────────────────┘
   │
   └─ relayConfidentialInvoice(exact bytes) ──> FlareSealEscrow
                                                     │ verify TEE signature
                                                     │ reject replayed actionId
                                                     └─ Invoice { Pending, confidential }

buyer ─ approve FXRP ─> fundInvoice ─> FTSOv2 XRP/USD ─> escrow holds FXRP
                          releasePayment / refundBuyer / claimExpiredRefund
```

| Component | Path | Stack |
|---|---|---|
| Escrow contract | `contracts/` | Solidity 0.8.27, Hardhat, OpenZeppelin v5 |
| FCC extension | `fcc/` | TypeScript on the official `fce-extension-scaffold`, Docker |
| Frontend | `web/` | Next.js 15 App Router, wagmi + viem, Tailwind |

Detailed docs: [ARCHITECTURE](docs/ARCHITECTURE.md) · [FCC flow](docs/FCC_FLOW.md) ·
[Security](docs/SECURITY.md) · [Deployment](docs/DEPLOYMENT.md) · [Demo runbook](docs/DEMO_RUNBOOK.md)

---

## Required software

| Tool | Version | Needed for |
|---|---|---|
| Node.js | ≥ 20 | contracts, frontend, FCC extension |
| npm | ≥ 10 | package management |
| Docker + Compose | current | the FCC TEE stack only |
| Go | ≥ 1.22 | FCC deployment tooling and the end-to-end test |
| ngrok or cloudflared | current | exposing the FCC proxy over HTTPS |

Contracts, the frontend, and the FCC unit tests run without Docker. Only the live confidential flow
needs the container stack.

---

## Wallet and faucet setup

1. Add Coston2 to your wallet:

   | Field | Value |
   |---|---|
   | Network | Flare Testnet Coston2 |
   | Chain ID | 114 |
   | RPC | `https://coston2-api.flare.network/ext/C/rpc` |
   | Currency | C2FLR |
   | Explorer | `https://coston2-explorer.flare.network` |

2. Get C2FLR (gas) and test FXRP from the [Flare faucet](https://faucet.flare.network).

3. The demo needs **two** addresses — a seller and a buyer. The escrow rejects an invoice where
   they match. Import a second account in your wallet's own UI; never share or generate a mnemonic
   through this project.

---

## Install

```bash
make install
```

Check what configuration is still missing at any point:

```bash
node scripts/check-env.mjs
```

Confirm the chain and the real Flare contracts are reachable — no key required:

```bash
node scripts/smoke-coston2.mjs
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

## Deploy the escrow to Coston2

```bash
cp contracts/.env.example contracts/.env
```

Fill in `DEPLOYER_PRIVATE_KEY` with a **funded testnet key you control**. It is read only from the
environment and is gitignored.

Resolve the real FXRP and FTSOv2 addresses through the Flare Contract Registry and the FAssets
Asset Manager:

```bash
cd contracts && npm run resolve:coston2
```

Deploy:

```bash
cd contracts && npm run deploy:coston2
```

This writes `contracts/deployments/coston2.json` (public metadata only — safe to commit).

---

## FCC configuration

```bash
cp fcc/.env.example fcc/.env
```

Set `ESCROW_CONTRACT_ADDRESS` to the address just deployed — the extension refuses to mint a result
for any other escrow.

Bring up the stack (`extension-tee`, `ext-proxy`, `redis`):

```bash
cd fcc
./scripts/use-chain.sh local coston2 typescript
./scripts/pre-build.sh
./scripts/start-services.sh
./scripts/post-build.sh
```

Or in one step:

```bash
cd fcc && ./scripts/full-setup.sh --chain coston2 --test
```

### Tunnel

The proxy's external port is `6674`. Expose it over HTTPS:

```bash
ngrok http 6674
```

or:

```bash
cloudflared tunnel --url http://localhost:6674
```

Put the resulting URL in `EXT_PROXY_URL` (fcc) and `FCC_PROXY_URL` (web). A restarted tunnel gets a
new URL — update both.

### TEE address

The escrow verifies results against one signing address, read from the proxy's `/info`:

```bash
cd contracts && npm run configure-tee:coston2
```

The script derives the address from `teeInfo.publicKey`, sets it via `setTeeAddress`, and reads it
back. Never point it at the proxy wallet, the extension owner, or the deployer.

---

## Frontend

```bash
cp web/.env.example web/.env.local
```

Fill in the escrow, InstructionSender, and FXRP addresses, plus `FCC_PROXY_URL`.

```bash
make sync-abi     # copy fresh ABIs out of the artifact trees
cd web && npm run dev
```

`FCC_PROXY_URL` is server-only: the browser calls `/api/fcc/*`, which proxies to it. The tunnel URL
is never sent to a page visitor.

---

## Demo

Full script with exact commands: [docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md). In short:

1. Connect the **seller** wallet, create a private invoice with two line items.
2. Confirm the instruction transaction, wait for the TEE result, confirm the relay.
3. Open the invoice — no line items are on-chain, only the commitment.
4. Connect the **buyer** wallet, open `/pay/<id>`.
5. Approve FXRP, fund at the live FTSOv2 rate, release payment.

---

## Verify everything offline

```bash
make verify
```

Runs the contract suite, the FCC extension unit tests, then the frontend's lint, typecheck, unit
tests, and production build. No chain, wallet, or Docker required.

---

## Deployed addresses

Live on **Flare Testnet Coston2** (chain 114):

| Contract | Address |
|---|---|
| `FlareSealEscrow` | [`0xEe7aDeb4268CDC40F3138F7caF08432A1433F204`](https://coston2-explorer.flare.network/address/0xEe7aDeb4268CDC40F3138F7caF08432A1433F204) |
| FXRP (`FTestXRP`, 6 dec) | [`0x0b6A3645c240605887a5532109323A3E12273dc7`](https://coston2-explorer.flare.network/address/0x0b6A3645c240605887a5532109323A3E12273dc7) |
| FTSOv2 | [`0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d`](https://coston2-explorer.flare.network/address/0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d) |
| `FlareSealInstructionSender` | Not yet deployed — needs the FCC stack |

Deployment transaction:
[`0x1e022add…b5e5acf1`](https://coston2-explorer.flare.network/tx/0x1e022add9356a631382b19f344f4f4c96489cc0d20bd66caf1207d94b5e5acf1)

`teeAddress` is not yet set, so `relayConfidentialInvoice` reverts with `TeeNotConfigured` until the
FCC stack is running. Full record in [BUILD_REPORT.md](BUILD_REPORT.md).

---

## Known limitations

- **Simulated TEE.** The local stack runs the extension in a simulated enclave against live
  Coston2. It is not hardware-attested, so a local operator could in principle observe plaintext.
  Production FCC requires a real Confidential Space VM with code-hash attestation.
- **Encrypted, not eternally private.** The ciphertext is public and permanent on-chain. It resists
  today's adversaries, not tomorrow's.
- **Testnet only.** Coston2, test FXRP, no real value.
- **Public fallback is unverified.** `createPublicInvoice` accepts a caller-supplied commitment that
  no TEE validated. It exists for demo continuity and is off unless
  `NEXT_PUBLIC_ENABLE_PUBLIC_MODE=true`. The UI labels every invoice created this way.
- **Unaudited.** No third-party security review.
- **Injected wallets only.** WalletConnect needs an external project id; the frontend uses the
  injected connector so it runs with no external accounts.
