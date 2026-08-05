# FlareSeal Build Report

Last updated: 2026-08-05

## Environment

- **OS:** Windows 11 Pro 10.0.22000
- **Node:** v24.12.0
- **npm:** 11.6.2
- **Docker:** **not installed on this machine** (`docker: command not found`)
- **Hardhat:** 2.29.0
- **Solidity:** 0.8.27 (optimizer on, 200 runs, evmVersion cancun)
- **ethers:** 6.17.0
- **OpenZeppelin Contracts:** 5.6.1
- **@flarenetwork/flare-periphery-contracts:** 0.1.52
- **Next.js:** 15.5.22 · **React:** 19.2.8 · **viem:** 2.55.11 · **wagmi:** 2.19.5
- **ecies-geth:** 1.8.0 · **vitest:** 2.1.9

---

## Implemented components

| Component | Status | Notes |
|---|---|---|
| `FlareSealEscrow.sol` | Complete | 608 lines; FCC relay, FTSOv2 pricing, escrow lifecycle, pause, no owner withdrawal |
| `IFtsoV2Minimal`, mocks | Complete | `MockERC20` (6 decimals), configurable `MockFtsoV2` |
| Contract scripts | Complete | `resolve-flare-addresses`, `deploy`, `configure-tee`, `export-abi`, `smoke-coston2`, `export-fcc-bindings` |
| Contract tests | Complete | 72 tests |
| `FlareSealInstructionSender.sol` | Complete | `INVOICE`/`CREATE`; scaffold registry wiring untouched |
| FCC TypeScript extension | Complete | Validation, bigint arithmetic, deterministic commitment, ABI result encoding |
| FCC unit tests | Complete | 91 tests |
| FCC end-to-end driver | Complete | `fcc/tools/cmd/run-test` — real encrypt → submit → poll → relay → read-back |
| Frontend | Complete | 6 routes, 2 API routes, full confidential state machine |
| Frontend tests | Complete | 83 tests |
| Root automation | Complete | `Makefile`, `sync-abi.mjs`, `check-env.mjs`, `smoke-coston2.mjs` |
| Documentation | Complete | README + 5 docs |

---

## Test results

### Contracts

```
cd contracts && npm test
```

```
72 passing (5s)
```

Covers: constructor validation, public invoice creation, FCC relay (valid signature, wrong signer,
wrong escrow, wrong relayer, replay, malformed data, unconsumed id on revert), quote math
($100 @ $0.50 → 200 FXRP; $100 @ $2.00 → 50 FXRP; ceiling rounding; zero/stale/future price),
funding, release, refund, expired refund, cancellation, pause, and a full confidential lifecycle
asserting no plaintext on-chain.

Coverage (`npm run coverage`):

```
File                   |  % Stmts | % Branch |  % Funcs |  % Lines |
 FlareSealEscrow.sol   |      100 |     87.7 |      100 |      100 |
 IFtsoV2Minimal.sol    |      100 |      100 |      100 |      100 |
```

**100% statement, function, and line coverage** on `FlareSealEscrow.sol`, against the 90% target.
Uncovered branches are defensive combinations inside already-covered require clauses.

### FCC extension

```
cd fcc/typescript && npx vitest run
```

```
Test Files  5 passed (5)
Tests      91 passed (91)
```

Covers invoice validation, integer-cent arithmetic, commitment determinism, ABI encoding, the wire
framework, and privacy assertions (no nonce, salt, reference, or description in the public result).

### Frontend

```
cd web && npm test && npm run lint && npm run typecheck && npm run build
```

```
Test Files  3 passed (3)
Tests      83 passed (83)

✔ No ESLint warnings or errors
tsc --noEmit: clean

Route (app)                                 Size  First Load JS
┌ ○ /                                    1.97 kB         229 kB
├ ○ /_not-found                            996 B         103 kB
├ ƒ /api/fcc/info                          128 B         103 kB
├ ƒ /api/fcc/result/[actionId]             128 B         103 kB
├ ○ /dashboard                           1.52 kB         252 kB
├ ƒ /invoices/[id]                       2.27 kB         252 kB
├ ○ /invoices/new                        21.4 kB         267 kB
└ ƒ /pay/[id]                             3.5 kB         254 kB
```

Build succeeds with no missing-key, invalid-hook, or hydration warnings. A `@next/swc-win32-x64-msvc`
native-binary warning appears on this machine and Next falls back to the WASM compiler; output is
unaffected.

### Live Coston2 connectivity

```
node scripts/smoke-coston2.mjs
```

```
Chain
  ok   chainId                114
  ok   latest block           33662129
FXRP
  ok   address                0x0b6A3645c240605887a5532109323A3E12273dc7
  ok   bytecode               177 bytes
  ok   symbol                 FTestXRP
  ok   decimals               6
FTSOv2
  ok   address                0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d
  ok   bytecode               170 bytes
```

Real reads against live Coston2 — no key required.

### Browser verification

The frontend was run (`next dev`) and driven in a browser: landing page, dashboard, new-invoice, and
an invalid invoice id all render with **no console errors**. Environment wiring, address display,
explorer URL construction, and the not-configured/not-connected gates were confirmed live.

### End-to-end (FCC)

**Not executed.** Requires Docker — see blockers.

---

## Coston2 deployment

Resolved from the live chain via the Contract Registry and FAssets Asset Manager
(`contracts/deployments/coston2-resolved.local.json`, 2026-08-04):

- **Contract Registry:** `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019`
- **FXRP Asset Manager:** `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA`
- **FXRP:** `0x0b6A3645c240605887a5532109323A3E12273dc7` (`FTestXRP`, 6 decimals) — matches the
  documented address
- **FTSOv2:** `0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d`

Deployed by this project:

- **Escrow address:** Not deployed
- **Escrow deployment transaction:** Not deployed
- **InstructionSender address:** Not deployed
- **InstructionSender deployment transaction:** Not deployed
- **Extension ID:** Not registered
- **TEE signing address:** Not configured
- **TEE configuration transaction:** Not deployed

---

## Demonstrated transactions

- **Confidential invoice request:** Not deployed
- **FCC relay:** Not deployed
- **FXRP approval:** Not deployed
- **Invoice funding:** Not deployed
- **Payment release or refund:** Not deployed

No transaction hashes are recorded because no deployment has occurred. Nothing above is simulated or
placeholder.

---

## Blockers

Both are external to the code and neither is resolvable from inside this environment.

### 1. No deployer private key

`contracts/.env` does not exist and no `DEPLOYER_PRIVATE_KEY` is available. Deployment, TEE
configuration, and every on-chain demonstration are blocked.

**To unblock:** generate a testnet key in your own wallet, fund it from
<https://faucet.flare.network>, put it in `contracts/.env`, then run:

```bash
cd contracts && npm run resolve:coston2 && npm run deploy:coston2
```

The key must be created and held by you. It is read only from the environment and is gitignored.

### 2. Docker not installed

`docker: command not found`, and no Docker install is present. The FCC stack (`extension-tee`,
`ext-proxy`, `redis`) cannot run, so:

- The Hello World scaffold validation was not executed.
- The extension was not registered and no extension id was assigned.
- The live `/info` endpoint was never reached, so no TEE signing address could be derived.
- The end-to-end test was not run.

This is the Level-3 scenario in the fallback strategy. Per that strategy, **no TEE signature was
faked and no FCC assertion was skipped or stubbed**. The complete handler, encryption path, unit
tests, Docker configuration, and end-to-end driver are implemented and committed; they are waiting
on a runtime, not on code.

**To unblock:** install Docker Desktop, then follow `docs/DEPLOYMENT.md` steps 4–7.

---

## Deviations from the build prompt

Each is a deliberate choice; the reasoning is recorded here as instructed.

1. **Wallet connector: injected instead of RainbowKit.** RainbowKit's `getDefaultConfig` requires a
   WalletConnect project id from an external account. Rather than ship a build that cannot run
   without a credential nobody has, the app uses wagmi's `injected` connector, which works with
   MetaMask and any injected Coston2 wallet. `@rainbow-me/rainbowkit` was removed from
   `package.json`.

2. **`injected` imported from `@wagmi/core`, not `wagmi/connectors`.** The barrel export pulls in
   every connector including Base Account's SDK, whose optional `@x402/*` peers are not installed
   and fail the production build. `@wagmi/core` ships its own lightweight `injected`.
   `@wagmi/core@^2.22.1` was added as an explicit dependency.

3. **`FCC_INSTRUCTION_FEE_WEI` → `NEXT_PUBLIC_FCC_INSTRUCTION_FEE_WEI`.** The prompt lists it as
   server-only, but the instruction transaction is sent by the browser wallet, so the value must
   reach the client. It remains operator-supplied and is never invented — unset means zero, correct
   for the current Coston2 registry. `FCC_PROXY_URL` stays strictly server-only as specified.

4. **UI primitives are hand-written in the shadcn/ui idiom** (`components/ui/primitives.tsx`) rather
   than pulled through the shadcn CLI, which wants an interactive init. Same patterns: CVA variants,
   `cn()` merging, forwarded refs, accessible semantics.

5. **Flare Developer Hub MCP server.** `claude mcp add` could not modify the running session. The
   `flare-devhub` MCP server and the Flare AI skills were available in-session and the official
   documentation URLs were used directly. No conflict with this prompt's constants was found: the
   XRP/USD feed id, chain constants, and FXRP address all matched what the live chain returned.

6. **Root `scripts/smoke-coston2.mjs` is dependency-free**, speaking raw JSON-RPC over `fetch`. It
   complements `contracts/scripts/smoke-coston2.ts` (Hardhat-based, exercises the deployed escrow)
   by needing neither `node_modules` nor a key.

---

## Secret safety

```bash
grep -RInE '(PRIVATE_KEY|MNEMONIC|SECRET|API_KEY|NGROK_AUTHTOKEN)=' . \
  --exclude-dir=node_modules --exclude-dir=.git --exclude='*.example'
```

No secrets belonging to this project are committed. No `.env` or `.env.local` file exists anywhere
in the tree. All matches are in the upstream `fce-extension-scaffold`:

- `fcc/docker-compose.yaml` and `fcc/scripts/start-services.sh` carry a **public dev default** for
  `PROXY_PRIVATE_KEY` in `${PROXY_PRIVATE_KEY:-…}` form — shipped by the scaffold for local
  simulated runs and overridden by `fcc/.env`. It must be overridden for anything beyond local
  simulation.
- Remaining matches are documentation examples with placeholder values.

`.gitignore` covers `**/.env`, `**/.env.local`, `fcc/config/extension.env`, `fcc/config/proxy/*.toml`,
`fcc/**/private*`, `*.pem`, `*.key`, and `contracts/deployments/*.local.json`, while allowing
`.env.example` files and `contracts/deployments/coston2.json` (public metadata only).

---

## Remaining work

Ordered by what unblocks the most:

1. Provide a funded `DEPLOYER_PRIVATE_KEY`; deploy the escrow; record the address and transaction.
2. Install Docker; validate the scaffold Hello World against live Coston2.
3. Register the extension; record the extension id and the InstructionSender address.
4. Start a tunnel; derive the TEE signing address from `/info`; run `configure-tee:coston2`.
5. Run `fcc/scripts/test.sh` and record the end-to-end result.
6. Populate `web/.env.local`; perform the two-wallet demo; record all transaction hashes here.
7. Run the Playwright smoke suite against a production build (`npm run test:e2e`) — the suite is
   written but has not been executed, since `npx playwright install` needs to fetch browsers.
