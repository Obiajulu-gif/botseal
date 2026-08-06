# FlareSeal — Hackathon Submission

> **Fill in before submitting:** the bounty selection (§2) and the demo video link (§5). Everything
> else is filled from the actual build. Nothing here is aspirational — every address and hash is
> real and verifiable on the Coston2 explorer.

---

## 1. Project name

**FlareSeal** — confidential invoices, settled in FXRP.

## 2. Selected bounty or bounties

> **← YOU MUST FILL THIS IN.** Pick from the program's bounty list. FlareSeal touches three Flare
> protocols, so it plausibly fits any of these — choose the one whose wording matches best rather
> than claiming all three:
>
> - **FAssets / FXRP** — the settlement asset is FXRP, resolved through the FAssets Asset Manager
>   and escrowed on-chain. This is the strongest fit.
> - **FTSO** — invoices are denominated in USD and priced into FXRP from the live FTSOv2 XRP/USD
>   feed at funding time, with on-chain staleness enforcement.
> - **Flare Confidential Compute (FCC/TEE)** — the confidential invoice extension is the novel part
>   of the build.

## 3. Short product description

FlareSeal is an invoice escrow where the commercial terms stay private but settlement stays public
and verifiable.

A seller fills in an invoice in the browser. Line items, descriptions, the customer reference, tax
and discount are encrypted locally to a Flare Confidential Compute TEE's public key and submitted
on-chain as ciphertext. Inside the enclave the TEE decrypts, validates, computes the total with
exact integer arithmetic, derives a hiding commitment over the full terms, and signs a minimal
public result. The escrow contract verifies that TEE signature, refuses to accept the same result
twice, and stores only what settlement needs: the two parties, the USD total, the due date, and the
32-byte commitment.

The buyer then funds in FXRP at the live FTSOv2 XRP/USD rate and releases payment to the seller.

The privacy is structural rather than promised: the escrow contract has no field in which a
description could be stored, so there is no "private mode" to misconfigure.

## 4. Target user

Freelancers, agencies, and small B2B suppliers invoicing crypto-native clients — people for whom
the *existence* and *settlement* of an invoice can be public, but the *contents* cannot.

Concretely, the pain being solved: putting an invoice on-chain today means publishing your rates,
your client list, and your margins to every competitor. FlareSeal keeps commercially sensitive
terms private while preserving the auditability that made on-chain settlement attractive.

Secondary user: the buyer, who gets escrow protection — funds are held by the contract, released
only by the buyer, refundable by the seller, and reclaimable by the buyer after the due date plus a
grace period.

## 5. Demo link / video / working app

- **Live app: https://flareseal.vercel.app** — connect any injected wallet on Coston2
- **Repository:** https://github.com/Obiajulu-gif/flareseal
- **Deployed escrow (live, verifiable):**
  [`0xEe7aDeb4268CDC40F3138F7caF08432A1433F204`](https://coston2-explorer.flare.network/address/0xEe7aDeb4268CDC40F3138F7caF08432A1433F204)
- **Demo script:** [docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md) — a deterministic ~10 minute walkthrough

The hosted app reads live Coston2 state on load, including the escrow's `teeAddress`. Because that
is not yet set, the UI reports **"Awaiting TEE"** and disables the private-invoice button rather
than letting a visitor pay gas for an instruction that cannot be relayed. The FXRP path — quote from
FTSOv2, approve, fund, release — is fully live.

> **← ADD A VIDEO LINK.** Record the DEMO_RUNBOOK walkthrough. Judges consistently rate a 3-minute
> screen recording above a written description. Show the instruction transaction's calldata on the
> explorer (opaque ciphertext) next to the escrow's stored invoice (no line items) — that contrast
> is the whole product in one frame.

## 6. GitHub repo / technical materials

**https://github.com/Obiajulu-gif/flareseal**

| Document | What it covers |
|---|---|
| [README.md](README.md) | Architecture, setup, deployment, demo |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, trust boundaries, on-chain vs private data, unit math |
| [docs/FCC_FLOW.md](docs/FCC_FLOW.md) | Byte-level FCC lifecycle: encryption, signature construction, replay protection |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, limitations, and what remains before this could hold real value |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Reproducible deployment order |
| [docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md) | Exact demo commands |
| [BUILD_REPORT.md](BUILD_REPORT.md) | Every command run, test result, and blocker — including what does *not* work |

**Test coverage:**

| Suite | Result |
|---|---|
| Solidity (Hardhat) | **72 passing**, 100% statement/line coverage on `FlareSealEscrow.sol` |
| FCC extension (vitest) | **91 passing** |
| FCC conformance (wire contract) | **15 passing** |
| Frontend (vitest) | **83 passing** |
| **Total** | **261 tests** |

## 7. How the project uses Flare

Three Flare protocols, each load-bearing rather than decorative.

### FTSOv2 — pricing

Invoices are denominated in USD cents; settlement happens in FXRP. `fundInvoice` reads
`FtsoV2Interface.getFeedByIdInWei(0x015852502f55534400…)` (XRP/USD) **on-chain at funding time** and
converts with exact integer arithmetic:

```
usdValueWei  = usdAmountCents × 1e16
requiredFxrp = ceil(usdValueWei × 10^decimals / xrpUsdPriceWei)
```

The frontend never supplies a price. It only supplies `maxFxrpAmount`, a slippage ceiling that can
make a transaction fail but never make it cost more. The contract rejects a zero price, a
future-dated observation, and anything older than `maxPriceAge` (600s).

Verified live: `XRP/USD = 1.067628 USD` at age 0s through the deployed contract's configured feed.

### FAssets / FXRP — settlement

FXRP is **resolved through the FAssets system at deploy time**, not hardcoded: Flare Contract
Registry → FXRP Asset Manager → `IAssetManager.fAsset()`. The deploy script asserts the resolved
address contains bytecode and reads `decimals()` from the token rather than assuming. The documented
address is used only as a warning-level sanity check.

Escrowed FXRP moves only via `releasePayment` (buyer), `refundBuyer` (seller), or
`claimExpiredRefund` (buyer, after the grace period). **There is no owner withdrawal path** —
`recoverUnsupportedToken` explicitly reverts for FXRP.

### Flare Confidential Compute — privacy

A TypeScript extension on the official `fce-extension-scaffold` handles `INVOICE`/`CREATE`. It
decrypts the ECIES payload inside the enclave, validates it, computes totals in `bigint`, derives a
deterministic hiding commitment, and returns an ABI-encoded result of
`(address,address,address,uint256,uint64,bytes32)`.

The escrow verifies the TEE signature using the current Flare domain-separated scheme:

```solidity
resultHash  = keccak256(abi.encodePacked(keccak256(data), actionId, keccak256(tag), status));
payloadHash = keccak256(abi.encode(bytes32("TEE_ACTION_RESULT"), block.chainid, resultHash));
recovered   = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(payloadHash), signature);
```

Two details that matter: `resultData` is hashed **exactly as received** and only decoded *after* the
signature verifies, and `block.chainid` is bound into the payload so a signature cannot be replayed
across chains. Every `actionId` is single-use.

## 8. What was newly built during the program

**Everything in this repository was written during the program.** It is not a port of an existing
product and there is no pre-existing codebase behind it.

**Built from scratch:**

- `FlareSealEscrow.sol` (~608 lines) — TEE-signature relay, replay protection, FTSOv2 pricing with
  staleness bounds, the full escrow state machine, pause, and a deliberate absence of any owner path
  to escrowed funds. 72 tests, 100% statement coverage.
- The FCC `INVOICE`/`CREATE` extension — validation, integer-cent arithmetic, and the deterministic
  terms commitment, with a privacy contract that no plaintext reaches a log, an error string, or the
  returned result.
- `FlareSealInstructionSender.sol` — the on-chain entry point.
- A Next.js 15 frontend — the complete confidential creation state machine (8 phases, 7 typed error
  states), FXRP approve/fund/release/refund, FTSOv2 quoting, and server-side FCC proxy routes so the
  tunnel URL is never exposed to the browser.
- Deployment, address-resolution, TEE-configuration, and smoke-check tooling.

**Integrated:** FTSOv2 block-latency feeds, the FAssets Asset Manager resolution path, and the
official FCC scaffold.

**Improved upstream (fixes contributed back into the vendored scaffold):**

- The conformance suite reported `16 passed` while asserting **nothing**. Two independent bugs: a
  native Windows `jq.exe` emits CRLF, leaving a stray `\r` inside every fixture path; and on a `jq`
  failure the expected/actual pair were both empty, compared equal, and every assertion block was
  skipped as "not requested". Fixed both, and added a guard so an unreadable fixture fails loudly.
  A test suite that cannot fail is worse than one that does.
- `generate-bindings.sh` hard-required Foundry. It now falls back to the Hardhat artifact, so the
  pipeline works on machines without `forge`.
- Added `.gitattributes` pinning LF for shell scripts, Dockerfiles, and YAML — on Windows,
  `core.autocrlf=true` silently rewrote every FCC script into something bash rejects with
  `/usr/bin/env: 'bash\r': No such file or directory`.

## 9. Deployment details

**Network: Flare Testnet Coston2 (chain ID 114).**

| Contract | Address |
|---|---|
| `FlareSealEscrow` | [`0xEe7aDeb4268CDC40F3138F7caF08432A1433F204`](https://coston2-explorer.flare.network/address/0xEe7aDeb4268CDC40F3138F7caF08432A1433F204) |
| `FlareSealInstructionSender` | [`0xF7F75FF93B500f7199E200Cb665A9573A2b73897`](https://coston2-explorer.flare.network/address/0xF7F75FF93B500f7199E200Cb665A9573A2b73897) |
| FXRP (`FTestXRP`, 6 dec) | [`0x0b6A3645c240605887a5532109323A3E12273dc7`](https://coston2-explorer.flare.network/address/0x0b6A3645c240605887a5532109323A3E12273dc7) |
| FTSOv2 | [`0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d`](https://coston2-explorer.flare.network/address/0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d) |
| FXRP Asset Manager | [`0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA`](https://coston2-explorer.flare.network/address/0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA) |
| TEE Extension Registry | [`0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE`](https://coston2-explorer.flare.network/address/0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE) |

**FCC extension ID: `0x…0101ac` (65964) — registered on-chain.** The InstructionSender's
`OP_TYPE_INVOICE`/`OP_COMMAND_CREATE` were read back from the deployed contract as `INVOICE`/`CREATE`,
matching the TypeScript extension's constants exactly.

**Deployment transaction:**
[`0x1e022add9356a631382b19f344f4f4c96489cc0d20bd66caf1207d94b5e5acf1`](https://coston2-explorer.flare.network/tx/0x1e022add9356a631382b19f344f4f4c96489cc0d20bd66caf1207d94b5e5acf1)

**Configuration:** owner `0x45F704D31C5affd5e32Fa457cC93a05fc4741706`, `maxPriceAge` 600s,
`refundGracePeriod` 604800s. Every immutable was read back off the deployed contract and verified.

## 10. Roadmap / next steps

**Immediate**

1. Complete the FCC registration on Coston2 and record the `InstructionSender` address, extension
   ID, and TEE configuration transaction.
2. Run the full two-wallet demo and record every transaction hash.
3. Record the demo video.

**Short term**

4. Commitment revelation UX — let a seller prove invoice terms to a third party by revealing the
   payload, with in-app verification against the on-chain commitment. This turns the commitment
   from an implementation detail into a user-facing feature.
5. Multi-asset settlement (FBTC, FDOGE) — the pricing path is already feed-agnostic.
6. Partial payments and instalment schedules.

**Before real value**

7. Third-party audit of the escrow and the extension handler.
8. Migration to a genuinely attested TEE on Confidential Space, with reproducible builds and
   code-hash verification.
9. Owner hardening — multisig or timelock, with monitoring on `TeeAddressUpdated` and `Paused`.

---

## Honest status

Judges should be able to trust the rest of this document, so:

**Working and verifiable on-chain today:** the escrow is deployed; FXRP is resolved through FAssets;
FTSOv2 pricing has been exercised live through the deployed contract; the full quote → approve →
fund → release path works with real testnet FXRP.

**Complete in code and fully tested, but not yet exercised end-to-end on-chain:** the confidential
creation path. The extension, encryption, signature scheme, replay protection, and relay are all
implemented and covered by 106 tests (91 unit + 15 conformance), and the contract-side verification
is covered by the Solidity suite. What is missing is a live FCC registration, which requires the
Docker TEE stack to be running.

Until `setTeeAddress` is called, `relayConfidentialInvoice` reverts with `TeeNotConfigured` — the
contract correctly refusing to accept a result it cannot verify.

**No TEE signature was ever faked and no FCC assertion was stubbed to produce a green result.** The
public-fallback invoice path exists for demo continuity, is environment-gated, and every invoice
created through it is labelled **"Public fallback"** in the UI with an empty FCC action ID.

## Traction

No users, no pilots, no partner conversations. This is a hackathon build at the end of its first
week. Claiming otherwise would be easy and worthless.

What exists instead is engineering evidence: 261 passing tests, 100% statement coverage on the
escrow contract, a live deployment, and a build report that documents its own failures.
