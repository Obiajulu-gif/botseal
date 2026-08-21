# Deployment

Exact order. Each step's output feeds the next, so running them out of order produces a stack that
looks configured but is not.

**Rehearse the whole sequence on testnet 968 first.** It costs nothing, and it catches everything
except gas price. There is no mainnet faucet — a failed mainnet deploy costs real BOT.

---

## 0. Prerequisites

```bash
node scripts/check-env.mjs
```

Node ≥ 20 and npm ≥ 10. No Docker, no Go, no tunnel.

---

## 1. Contract environment

```bash
cp contracts/.env.example contracts/.env
```

| Variable | Meaning |
|---|---|
| `BOTCHAIN_RPC_URL` | `https://rpc.botchain.ai` |
| `BOTCHAIN_TESTNET_RPC_URL` | `https://rpc.bohr.life` |
| `DEPLOYER_PRIVATE_KEY` | A funded key **you** generate and control |
| `OWNER_ADDRESS` | Escrow owner; defaults to the deployer |
| `REFUND_GRACE_PERIOD_SECONDS` | Delay before a buyer may reclaim (default 604800) |
| `SETTLEMENT_TOKEN_ADDRESS` | Required on testnet; optional on mainnet |

> Generate the key in your own wallet or with a tool you trust. Never paste a key that holds
> significant value, and never commit `.env` — it is gitignored.

Funding the deployer:

- **Testnet** — <https://faucet.botchain.ai>
- **Mainnet** — no faucet. Acquire BOT via the bridge or B DEX before you start.

---

## 2. Settlement token

**Mainnet** needs no configuration. The deploy script defaults to USDT and verifies it:

| | |
|---|---|
| USDT | `0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C` |
| Reports | `Tether USD` / `USDT` / 6 decimals |

The script **refuses to deploy** against a mainnet token that does not report `USDT` and 6 decimals.

**Testnet** has no canonical USDT, so deploy a 6-decimal mock and point at it:

```bash
cd contracts && npx hardhat console --network botchainTestnet
```

```js
const F = await ethers.getContractFactory("MockERC20");
const t = await F.deploy("Test USD", "USDT", 6);
await t.waitForDeployment();
console.log(await t.getAddress());
await t.mint("<buyer address>", 1000000n * 10n ** 6n);
```

Set `SETTLEMENT_TOKEN_ADDRESS` to that address.

> **Do not point testnet at the mainnet USDT address.** On chain 968 that address holds an unrelated
> 18-decimal token called "Weslie". Deploying against it would mis-scale every invoice by 10¹². The
> script refuses this specific mistake by name, because it is silent and catastrophic otherwise.

---

## 2a. Rehearse the whole flow offline

Before spending anything, prove the sequence works:

```bash
cd contracts && npm run rehearse
```

Deploys, relays an attestor-signed invoice, funds and releases it on hardhat's in-process network —
no gas, no key, no testnet. Asserts the total is stored exactly, the relay calldata contains no
plaintext, a replay is rejected, and the seller is paid to the wei.

With the frontend running it drives the **real** attestor service over HTTP rather than signing
locally, which is the one seam neither test suite covers on its own:

```bash
ATTESTOR_BASE_URL=http://127.0.0.1:3000 npm run rehearse
```

The output says which mode it ran in.

---

## 3. Deploy the escrow

Testnet rehearsal:

```bash
cd contracts && npm run deploy:testnet
```

Mainnet:

```bash
cd contracts && npm run deploy:botchain
```

The script asserts the network is 677 or 968, verifies the settlement token, deploys, waits for
confirmations, then reads every immutable back off the contract and checks it matches what was
intended. Output goes to `contracts/deployments/botchain-<chainId>.json` — public metadata only,
safe to commit.

Verify independently, no key needed:

```bash
cd contracts && npm run smoke:botchain     # or smoke:testnet
```

This re-checks that `tokenScale == 10 ** decimals()`, that mainnet settles in USDT/6, that the owner
is set, whether an attestor is configured, and that `totalEscrowed` is backed by the contract's real
token balance.

---

## 4. Attestor environment

```bash
cp web/.env.example web/.env.local
```

| Variable | Source | Exposure |
|---|---|---|
| `NEXT_PUBLIC_CHAIN_ID` | `677` or `968` | public |
| `NEXT_PUBLIC_RPC_URL` | step 1 | public |
| `NEXT_PUBLIC_EXPLORER_URL` | `https://scan.botchain.ai` | public |
| `NEXT_PUBLIC_ESCROW_ADDRESS` | step 3 | public |
| `NEXT_PUBLIC_SETTLEMENT_TOKEN_ADDRESS` | step 2 | public |
| `NEXT_PUBLIC_ENABLE_PUBLIC_MODE` | `false` unless demoing the fallback | public |
| **`ATTESTOR_PRIVATE_KEY`** | **you generate it** | **server-only** |
| `ATTESTOR_ESCROW_ADDRESS` | defaults to the escrow above | server-only |

`ATTESTOR_PRIVATE_KEY` is the whole trust assumption of the confidential path. Whoever holds it can
mint settlement facts the escrow accepts and can read any invoice submitted to the service.

- Generate it in your own wallet tooling. It is a fresh key with no other purpose.
- Put it in the host's secret store, never in a committed file.
- Never prefix it `NEXT_PUBLIC_` — that inlines it into the browser bundle.
- Rotate it after any public demo.

`lib/attestor/signer.ts` imports `server-only`, so an accidental client import fails the build
rather than shipping the key.

---

## 5. Point the escrow at the attestor

Start the app so `/api/attestor/info` is reachable, then:

```bash
cd contracts && npm run configure-attestor:botchain
```

Reads `/info`, cross-checks that the advertised public key derives to the advertised address —
an `/info` that advertises one key for encryption and a different address for verification would
silently produce invoices the escrow can never accept — calls `setAttestorAddress`, and reads it
back to confirm.

Set `ATTESTOR_SIGNING_ADDRESS` explicitly to skip discovery. Set `ATTESTOR_URL` to let the script
find it.

Until this runs, `relayConfidentialInvoice` reverts with `AttestorNotConfigured` and the UI hides
the confidential path rather than walking a seller toward a relay that cannot succeed.

---

## 6. Verify the attestor end to end

```bash
cd web && npm run check-attestor
```

or against a deployed host:

```bash
ATTESTOR_BASE_URL=https://your-app.example npm run check-attestor
```

Asserts the total is recomputed rather than trusted, the signature recovers to the advertised
address, the attestation id is deterministic, an invalid invoice is refused with 422, and a garbage
ciphertext fails with a uniform 400. Read-only: no transaction, no key.

---

## 7. Frontend

```bash
make sync-abi
cd web && npm run build && npm run start
```

`sync-abi` recompiles first, so the ABI cannot go stale against a contract you changed.

---

## 8. Seed a demo invoice (optional)

```bash
cd contracts && BUYER_ADDRESS=0x… npm run seed-demo:botchain
```

Creates a **public fallback** invoice so a reviewer has real on-chain state to look at. It is marked
`confidential = false` and the UI labels it as such. It does not stand in for an attestor-validated
invoice.

---

## Rollback and rotation

- **Redeploying the escrow** invalidates every signature minted for the old address — the EIP-712
  domain binds `verifyingContract`. Update `NEXT_PUBLIC_ESCROW_ADDRESS` and
  `ATTESTOR_ESCROW_ADDRESS`, restart the app, and re-run step 5.
- **Rotating the attestor key** requires re-running step 5. Existing invoices remain valid and
  settleable; there is a test asserting this.
- **Pausing** (`pause()`) halts creation, funding, release and refund. Use only to stop the bleeding
  during an incident — it blocks settlement for honest users too.
