# MIGRATION_PLAN.md — FlareSeal → BotSeal on BOT Chain

**Status:** Phase 0 (planning). No implementation code written yet.
**Written:** 2026-08-19
**Target:** BOT Chain Builder Challenge #2, RWA Applications track
**Hard deadline:** 2026-08-22, 23:59 UTC+8 — **16:59 WAT on Aug 22**, i.e. ~3.5 working days from now

---

## 0. What changed, and why this plan is not the plan I would have written yesterday

The hackathon brief inverts two of my earlier defaults and compresses everything else:

| Earlier assumption | Reality |
|---|---|
| Deploy to testnet 968; mainnet only on explicit approval | **Mainnet 677 is mandatory.** Testnet-only submissions are not reviewed at all. Testnet becomes a rehearsal step, nothing more. |
| Unbounded schedule, build the port properly | **~3.5 days.** Product completion is 30% of the score. Anything that cannot ship is worse than useless — it eats time that completion needs. |
| Keep an oracle seam for future BOT settlement | Cut. Stablecoin settlement removes the oracle entirely, and the seam is a post-deadline concern. |
| Port the FCC extension stack | The Docker + Go + Python stack cannot ship in 3 days and does not need to. It collapses into ~200 lines of serverless TypeScript. |

The single most important consequence: **removing the oracle and the FXRP dependency actually makes
this project simpler than it is today, not harder.** That is what makes the deadline survivable.

### Track selection: RWA, not AI

Invoices are receivables. Receivables financing is one of the largest real-world RWA categories
that exists. The brief names RWA the *highest priority* track and lists "asset issuance, asset
management, asset distribution, revenue distribution" as in-scope — which is a fair description of
what this contract already does.

The AI track requires AI to be "a core capability participating in on-chain business processes."
Bolting an LLM onto invoice creation in three days would be exactly the "auxiliary copywriting
generation" the brief explicitly excludes. **Enter RWA.** It is the stronger fit and the higher
priority, and it needs no new subsystem.

### The disclosure requirement — read this before anything else

The brief has a Migration Projects section that explicitly welcomes projects live on other chains,
and requires them to answer three questions: why BOT Chain, what new capabilities the BOT Chain
version adds, and how you will grow on-chain activity.

That means the Flare origin **must be disclosed in the submission.** This does not conflict with
stripping Flare out of the code — those are different surfaces:

- **Code, config, branding, docs:** Flare-free. That is a product-quality requirement.
- **Submission form and a one-line README provenance note:** discloses the migration honestly.

Entering as a migration project while concealing the origin would be misrepresentation, and the
"originality" rule is aimed at re-entering prior *BOT Chain* entries under a new name — which does
not apply here. See Open Question 1 for the one thing I cannot verify on your behalf.

---

## 1. Verified findings

Everything below was confirmed live against the RPC or the repo on 2026-08-19. Evidence is given
because several of these contradict the published docs.

### Chain

| Fact | Evidence |
|---|---|
| Mainnet chain id 677 | `eth_chainId` → `0x2a5` at `https://rpc.botchain.ai` |
| Testnet chain id 968 | `eth_chainId` → `0x3c8` at `https://rpc.bohr.life` |
| Client is `Geth/v1.5.13` (BSC lineage), Go 1.26 | `web3_clientVersion`, both networks |
| Gas price 20 gwei, `baseFeePerGas` 0 | `eth_gasPrice` → `0x4a817c800` |

**Cancun opcodes: confirmed supported. Risk closed, no deployment needed.** Rather than deploy a
canary, the opcodes were executed directly as `eth_call` init code, which costs nothing and needs no
key:

| Probe | Init code | Mainnet 677 | Testnet 968 |
|---|---|---|---|
| `MCOPY` (0x5E) | `0x60AA6000536001600060205E60016020F3` | `0xaa` ✅ | `0xaa` ✅ |
| `TSTORE`/`TLOAD` (0x5C/0x5D) | `0x60BB60005C60005D60005260206000F3` | `0x…bb` ✅ | `0x…bb` ✅ |

Both return the expected values on both networks, so `evmVersion: "cancun"` and OpenZeppelin v5 are
safe as they stand. This is corroborated by the block headers, which carry `excessBlobGas`,
`blobGasUsed`, `parentBeaconBlockRoot` and `withdrawalsRoot`.

**`eth_getLogs` is more restricted than the docs say, and it does not matter to us.** The docs claim
it is disabled on mainnet. In practice a `latest`→`latest` query returns real logs, while a
*ranged* query over 50 or 500 blocks is rejected with `invalid block range params`. So ranged log
scans are out. The frontend never does one — `web/hooks/use-invoices.ts` enumerates through the
`getSellerInvoiceIds` / `getBuyerInvoiceIds` view functions, and the only receipt-log read is
`eth_getTransactionReceipt`, which is unaffected. **No work required. Risk closed.**

### Tokens

| Address | Mainnet 677 | Testnet 968 |
|---|---|---|
| `0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C` | **Tether USD / USDT / 6 decimals** / 6188 bytes | An unrelated token: **"Weslie" / WES / 18 decimals** |
| `0xD5452816194a3784dBa983426cCe7c122F4abd30` | Wrapped BOT / WBOT / 18 decimals | WBOT / 18 decimals (same address) |

Two things follow. First, **USDT is 6 decimals — exactly what FXRP was.** The escrow caches
`fxrpScale = 10 ** decimals()` at construction, so the token swap is nearly free. Second, **the
mainnet USDT address holds a different token on testnet**, so testnet rehearsal needs a locally
deployed 6-decimal mock. Never point testnet config at the mainnet USDT address.

### Repo

- **1323 Flare references across 159 files.** Most are naming; the protocol-bearing ones are few.
- The confidential path is ~1100 lines total: `fcc/typescript/src/app/handlers.ts` (157),
  `invoice.ts` (313), `web/lib/fcc.ts` (202), `web/hooks/use-confidential-invoice.ts` (318),
  `fcc/contracts/InstructionSender.sol` (109).
- **Encryption is already portable.** `web/lib/fcc.ts` uses `ecies-geth`, a plain JS library. It
  runs unchanged in a Node serverless function. This is the finding that makes Decision 4 cheap.
- Contract test suite is 48908 bytes / ~100 Flare references. It ports; it does not get rewritten.
- **Baseline established: `cd contracts && npm test` → 72 passing, 23s, exit 0.** That is the number
  Phase 2 has to hold. The suite covers funding, release, both refund paths, cancellation,
  administration, pause behaviour, and one end-to-end confidential lifecycle test that asserts no
  plaintext reaches the chain.
- Toolchain present locally: Node 24.12, npm 11.6, Go 1.26.1, Docker 29.6.

---

## 2. Touchpoint inventory

### 2a. Protocol — real work, changes behaviour

| Location | Today | Becomes |
|---|---|---|
| `FlareSealEscrow.sol:15,207,585-593` | `IFtsoV2Minimal FTSO_V2`, `_readXrpUsdPrice()` | **Deleted.** No oracle. |
| `FlareSealEscrow.sol:81-82` | `XRP_USD_FEED_ID` constant | Deleted |
| `FlareSealEscrow.sol:93,206,394,413,432,457,527` | `IERC20Metadata FXRP` | `IERC20Metadata SETTLEMENT_TOKEN` (USDT) |
| `FlareSealEscrow.sol:96-98` | `fxrpScale` | `tokenScale` |
| `FlareSealEscrow.sol:56-57` | `fxrpAmount`, `xrpUsdPriceWei` on `Invoice` | `tokenAmount`; price field deleted |
| `FlareSealEscrow.sol:100,136-137,383` | `maxPriceAge`, `StalePrice`, `InvalidPrice`, `SlippageExceeded` | All deleted |
| `FlareSealEscrow.sol:595-607` | `_usdCentsToFxrp` via `Math.mulDiv` | `_usdCentsToTokens`: `cents * 10**(6-2)`, exact |
| `FlareSealEscrow.sol:367-394` | `fundInvoice(id, maxFxrpAmount)` | `fundInvoice(id)` — slippage is meaningless in a stablecoin |
| `FlareSealEscrow.sol:84-85,297-322` | `TEE_ACTION_RESULT` prefix, Flare digest scheme | EIP-712 typed data, chain-bound domain |
| `FlareSealEscrow.sol:113-114,500-509` | `teeAddress`, `setTeeAddress` | `attestorAddress`, `setAttestorAddress` |
| `FlareSealEscrow.sol:117,142,269` | `consumedFccActionIds`, `FccActionAlreadyConsumed` | `consumedAttestationIds` — **replay guard is kept intact** |
| `contracts/interfaces/IFtsoV2Minimal.sol` | Flare periphery import + selector parity test | **File deleted** |
| `contracts/mocks/MockFtsoV2.sol` | FTSO mock | **File deleted** |
| `contracts/package.json:deps` | `@flarenetwork/flare-periphery-contracts` | **Dependency removed** |
| `fcc/**` (entire tree, ~200 files) | Docker + Go + Python + TS extension scaffold, TEE registries, InstructionSender | **Deleted.** Replaced by `web/app/api/attestor/*` |

### 2b. Config — mechanical but must be exact

`contracts/hardhat.config.ts` (chain 114 → 677/968) · `contracts/.env.example` ·
`contracts/deployments/coston2.json` → `botchain-677.json` · `web/lib/flare.ts` → `web/lib/chain.ts`
(viem has no BOT Chain definition; use `defineChain`) · `web/lib/env.ts` · `web/lib/wagmi.ts` ·
`web/lib/explorer.ts` · `web/.env.example` · `web/.env.production` · `scripts/check-env.mjs` ·
`scripts/smoke-coston2.mjs` → `scripts/smoke-botchain.mjs` · `Makefile` (9 refs)

### 2c. Naming and brand

`FlareSealEscrow.sol` → `BotSealEscrow.sol` · `contracts/test/FlareSealEscrow.test.ts` ·
`web/lib/abi/FlareSealEscrow.json` · both `package.json` names · `web/public/logo.svg`,
`mark.svg`, `brand/flareseal-logo.png` · all `NEXT_PUBLIC_*` var names · UI copy in
`web/app/**` (page.tsx, layout.tsx, dashboard, invoices, pay) · `web/components/wallet.tsx`

### 2d. Docs — rewritten, not find-and-replaced

`README.md` (36) · `SUBMISSION.md` (49) · `BUILD_REPORT.md` (54) · `docs/ARCHITECTURE.md` (17) ·
`docs/DEPLOYMENT.md` (28) · `docs/SECURITY.md` (13) · `docs/DEMO_RUNBOOK.md` (12) ·
`docs/FCC_FLOW.md` (3, deleted and replaced by `docs/CONFIDENTIAL_FLOW.md`)

---

## 3. Decisions

| # | Decision | Choice | Why, and what it costs to reverse |
|---|---|---|---|
| 1 | Name | **BotSeal** — `BotSealEscrow`, `botseal` | Ties to the chain, one syllable from the original so muscle memory holds. Reversible in one sweep before deploy; expensive after, because the mainnet address is in the submission. **Decide before Phase 1.** |
| 2 | Settlement asset | **USDT `0xaBabc7…7a3C`** on mainnet; 6-decimal `MockERC20` on testnet | Verified live: real Tether USD, 6 decimals, same as FXRP. Invoices are USD-denominated, so a USD stablecoin is the honest asset. Also the strongest RWA-track story: real settlement rails, not a synthetic testnet asset. |
| 3 | Pricing | **Delete the oracle entirely.** `cents × 10⁴ = USDT units`, exact | BOT Chain has no on-chain oracle, and with a USD stablecoin it needs none. Removes staleness, slippage, rounding and an entire class of test. Biggest single schedule win. Re-adding a seam later is a contained change. |
| 4 | Confidentiality | **Collapse `fcc/` into a Next.js API route.** Attestor keypair in server env; `ecies-geth` decrypt; validate; sign EIP-712; escrow verifies against `attestorAddress` | Keeps every property that matters — browser-side encryption, off-chain validation, signed result, replay guard, on-chain commitment — and drops only the hardware attestation, which BOT Chain cannot provide anyway. Also **removes a whole transaction**: no on-chain InstructionSender round-trip, so the seller signs 2 txs instead of 3. Ships in a day instead of a week. |
| 5 | Invoice enumeration | **No change needed** | Already view-function based. Verified mainnet rejects ranged `getLogs`; nothing depends on it. |
| 6 | BOT-Chain-native extras | **Blobs: out.** **ERC-4337 / EOA Paymaster: out of v1, in the roadmap** | Both are genuine differentiators and neither is worth risking completion for. The "new capability" answer is carried by USDT settlement, the removed transaction, and mainnet real-value operation. Revisit only if Phase 5 finishes early. |
| 7 | Target network | **Mainnet 677 is the deliverable.** Testnet 968 is a rehearsal gate | Mandated. Testnet rehearsal is not optional though — it is how we avoid burning real BOT on a failed deploy. |

### Trust model, stated plainly

The shipped system has **a server-side attestor key that we operate**. It is not a TEE, there is no
hardware attestation, and an operator with server access can read invoice plaintext in memory.
What it does provide: the plaintext never touches the chain, the on-chain commitment binds the
private terms, the total is validated before it is signed, and results cannot be replayed.

The README, `docs/SECURITY.md` and the UI all say this in those words. We do not describe it as a
TEE. The existing "Known limitations" section is the right model — it gets extended, not trimmed.

---

## 4. Phases and time budget

Every phase ends with tests green and a commit. Branch: `botchain-migration` off `main`.

| Phase | Work | Exit criterion | Status |
|---|---|---|---|
| **1. Chain layer** | Hardhat networks 677/968, `defineChain` for viem, env vars, explorer URLs, deployments path | compile clean; Cancun confirmed | ✅ `7dfcb69` |
| **2. Contract surgery** | Delete oracle + FXRP, USDT math, EIP-712 attestor verification, rename. Port the test suite. | `npm test` green | ✅ `711aebe` — 66 passing, 100% line/stmt/func coverage |
| **3. Attestor** | `web/app/api/attestor/{info,create}`; ECIES decrypt, validate, EIP-712 sign. Delete `fcc/`. | round-trip produces a signature the contract accepts | ✅ `c120816` — verified live, not just unit-tested |
| **4. Rename & brand** | Contracts, packages, env prefixes, dirs, logo, all UI copy | zero `flare\|coston\|ftso\|fxrp` outside `docs/` | ✅ `c120816` |
| **5. Frontend** | BOT Chain wallet/network config, USDT approve+fund, confidential flow, copy | `make verify` green | ✅ absorbed into 3–4 — 88 tests, lint/typecheck/build clean |
| **6. Testnet rehearsal → mainnet deploy** | Rehearse on 968, deploy to 677, verify on `scan.botchain.ai`, seed a demo invoice | Mainnet addresses recorded; end-to-end flow with two real wallets | ⛔ **blocked on BOT + USDT** |
| **7. Docs, video, submission** | README, architecture, security, runbook rewritten. Demo video. Migration answers. | Submission filed before 16:59 WAT Aug 22 | ⏳ next |

Phase 5 folded into 2–4: the frontend could not typecheck until the hooks, env and copy moved
with the contract, so it moved with them rather than being deferred.

**Phase 6 is the one that cannot slip.** If Phase 5 is late, ship the public-invoice path on mainnet
and label the confidential path as beta — a deployed product with one flow beats a perfect product
that missed the deadline. Completion is 30% of the score; the confidential path is part of the 20%
innovation.

---

## 5. Risk register

| # | Risk | Severity | Detection | Fallback |
|---|---|---|---|---|
| 1 | **No BOT for mainnet gas.** Deploy needs real BOT; there is no mainnet faucet. | **Blocking** | Check balance today | Claim the challenge's 1 BOT gas support, or swap on BDEX / bridge. **Start this today, in parallel — it gates Phase 6.** |
| 2 | **No mainnet USDT for the demo.** A real business loop needs a funded buyer. | **Blocking** | Check balance today | Bridge or swap a small amount. Needs only a few USDT. Start today. |
| 3 | Deadline compression | High | Daily check against the table above | Cut in this order: ERC-4337 → demo video polish → confidential path (ship public-invoice only) |
| 4 | Attestor key handling on Vercel | High | Review before Phase 6 | Server-only env var, never `NEXT_PUBLIC_`. Rotate after the demo. Never commit. |
| 5 | ~~Cancun opcode support~~ | **CLOSED** | Settled 2026-08-20, see below | — |
| 6 | Mainnet RPC restrictions beyond `getLogs` | Medium | Smoke every RPC method the app uses, on 677, in Phase 6 | WSS endpoint `wss://ws-rpc.botchain.ai`, or a third-party RPC |
| 7 | Contract verification unavailable on `scan.botchain.ai` | Medium | Try in Phase 6 with time to spare | Publish standard-JSON input + a build-reproduction script in the repo |
| 8 | Judges read the migration as a superficial port | Medium | — | The answer must be concrete: USDT rails, one fewer transaction, oracle-free settlement, mainnet real-value. Write it in `SUBMISSION.md`, not just the form. |
| 9 | Testnet/mainnet address confusion (WES vs USDT) | Medium | Assert `symbol()=="USDT"` and `decimals()==6` in the deploy script | Deploy script refuses to proceed on mismatch |

---

## 6. Open questions

Each has a working default so nothing blocks on your answer.

1. **Was FlareSeal submitted to a Flare hackathon, and do that event's rules allow entering the same
   work elsewhere?** `SUBMISSION.md` suggests it was. BOT Chain's migration rules clearly permit
   this; the other event's rules are yours to check, and I cannot verify them. *Default: proceed,
   disclose the migration in the submission.*
2. **Name — BotSeal?** *Default: yes. Must be settled before Phase 1 starts.*
3. **Who operates the attestor key in the demo, and on what host?** *Default: a fresh key in Vercel
   server env, rotated after judging.*
4. **Is there an existing Vercel project to reuse, or a new deployment?** The current app is at
   `flareseal.vercel.app`, which is a Flare-branded URL. *Default: new project, new URL.*
5. **Do you already hold BOT and USDT on mainnet?** *Default: assume no, start acquiring today.*

---

## 7. Branch and rollback

- Work on `botchain-migration`; `main` keeps the working Flare version untouched as a reference.
- One commit per phase, tests green at each.
- `fcc/` deletion gets its own commit so it can be reverted independently.
- Tag `pre-mainnet-deploy` immediately before Phase 6.
- Mainnet addresses recorded in `contracts/deployments/botchain-677.json` and in `README.md` the
  moment they exist — an unrecorded mainnet deployment is a lost deployment.

---

## What I need from you to start Phase 1

1. Confirm or change the name (**BotSeal**).
2. Confirm the RWA track choice.
3. Start acquiring mainnet **BOT** (gas) and a few **USDT** (demo) — this is the longest-lead item
   and it gates the only mandatory requirement.

Then say go, and I start with the chain layer and the Cancun canary.
