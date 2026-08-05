# Deployment

Exact order. Each step's output feeds the next, so running them out of order produces a stack that
looks configured but is not.

---

## 0. Prerequisites

```bash
node scripts/check-env.mjs
```

```bash
node scripts/smoke-coston2.mjs
```

The second needs no key and proves the chain, FXRP, and FTSOv2 are reachable before you spend gas.

---

## 1. Contract environment

```bash
cp contracts/.env.example contracts/.env
```

| Variable | Meaning |
|---|---|
| `COSTON2_RPC_URL` | `https://coston2-api.flare.network/ext/C/rpc` |
| `DEPLOYER_PRIVATE_KEY` | A funded testnet key **you** generate and control |
| `OWNER_ADDRESS` | Escrow owner; defaults to the deployer |
| `MAX_PRICE_AGE_SECONDS` | FTSOv2 freshness window (default 600) |
| `REFUND_GRACE_PERIOD_SECONDS` | Delay before a buyer may reclaim (default 604800) |

> Generate the key in your own wallet or with a tool you trust. Never paste a key that holds real
> value, and never commit `.env` — it is gitignored.

Fund the deployer with C2FLR from <https://faucet.flare.network>.

---

## 2. Resolve the real Flare addresses

```bash
cd contracts && npm run resolve:coston2
```

This walks the actual registry rather than trusting a literal:

1. Flare Contract Registry → FXRP Asset Manager
2. `IAssetManager.fAsset()` → FXRP
3. Registry → FTSOv2
4. Asserts both addresses contain bytecode
5. Prints the token symbol and decimals
6. Compares against the documented FXRP address as a **warning-level** check only

Writes `contracts/deployments/coston2-resolved.local.json` (gitignored).

Verified on Coston2:

| | |
|---|---|
| Contract Registry | `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` |
| FXRP Asset Manager | `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA` |
| FXRP | `0x0b6A3645c240605887a5532109323A3E12273dc7` (`FTestXRP`, 6 decimals) |
| FTSOv2 | `0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d` |

---

## 3. Deploy the escrow

```bash
cd contracts && npm run deploy:coston2
```

The script asserts chain 114, deploys, waits for confirmations, then reads every immutable back off
the contract and checks it matches what was intended. Output goes to
`contracts/deployments/coston2.json` — public metadata only, safe to commit.

Verify independently:

```bash
node scripts/smoke-coston2.mjs
```

---

## 4. FCC environment

```bash
cp fcc/.env.example fcc/.env
```

| Variable | Meaning |
|---|---|
| `DEPLOYMENT_PRIVATE_KEY` | Funded key for FCC deployments |
| `INITIAL_OWNER` | Extension owner |
| `PROXY_PRIVATE_KEY` | Proxy wallet key |
| `CHAIN_URL` | `https://coston2-api.flare.network/ext/C/rpc` |
| `ADDRESSES_FILE` | `./config/coston2/deployed-addresses.json` |
| `LOCAL_MODE` | `false` |
| `SIMULATED_TEE` | `true` |
| `EXT_PROXY_URL` | Your tunnel URL (step 6) |
| **`ESCROW_CONTRACT_ADDRESS`** | **The escrow from step 3** |

`ESCROW_CONTRACT_ADDRESS` is load-bearing: the extension rejects any payload naming a different
escrow, which is what prevents a result minted here being relayed into another deployment.

---

## 5. Bring up the FCC stack

```bash
cd fcc
./scripts/use-chain.sh local coston2 typescript
./scripts/pre-build.sh
./scripts/start-services.sh
./scripts/post-build.sh
```

Or:

```bash
cd fcc && ./scripts/full-setup.sh --chain coston2 --test
```

Services: `extension-tee`, `ext-proxy`, `redis`. Before customising further, confirm the unmodified
Hello World path works — the scaffold's own test proves the registry wiring independently of any
FlareSeal code.

Note the deployed `FlareSealInstructionSender` address from the scaffold's output.

---

## 6. Tunnel

The proxy's external port is `6674`.

```bash
ngrok http 6674
```

```bash
cloudflared tunnel --url http://localhost:6674
```

Put the HTTPS URL in `EXT_PROXY_URL` (fcc) and `FCC_PROXY_URL` (web). **A restarted tunnel gets a
new URL** — the most common cause of a working stack suddenly reporting `extension-unavailable`.

Confirm:

```bash
curl -s $EXT_PROXY_URL/info | jq '.teeInfo.publicKey, .machineData.extensionId'
```

---

## 7. Configure the TEE address

```bash
cd contracts && npm run configure-tee:coston2
```

Reads `/info`, derives the signing address from `teeInfo.publicKey` (the same derivation tee-node's
own tooling uses), calls `setTeeAddress`, and reads it back to confirm.

Set `TEE_SIGNING_ADDRESS` explicitly to skip discovery. Never use the proxy wallet, extension owner,
or deployer address — only the address `/info` identifies as the active signer.

Record the transaction hash in `BUILD_REPORT.md`.

---

## 8. Frontend

```bash
cp web/.env.example web/.env.local
make sync-abi
```

| Variable | Source |
|---|---|
| `NEXT_PUBLIC_ESCROW_ADDRESS` | step 3 |
| `NEXT_PUBLIC_INSTRUCTION_SENDER_ADDRESS` | step 5 |
| `NEXT_PUBLIC_FXRP_ADDRESS` | step 2 |
| `FCC_PROXY_URL` | step 6 (server-only) |
| `NEXT_PUBLIC_ENABLE_PUBLIC_MODE` | `false` unless demoing the fallback |

```bash
cd web && npm run build && npm run start
```

---

## 9. End-to-end verification

```bash
cd fcc && ./scripts/test.sh
```

This drives the real sequence — encrypt, submit, poll, relay, read back — and asserts the seller,
buyer, total, commitment, confidential flag, consumed action id, and Pending status. It fails on
timeout or a wrong status; nothing is skipped silently.

---

## Rollback and rotation

- **Redeploying the escrow** invalidates every FCC result minted for the old address. Update
  `ESCROW_CONTRACT_ADDRESS`, restart the extension, and re-run step 7.
- **Rotating the TEE key** requires re-running step 7. Existing invoices remain valid.
- **Pausing** (`pause()`) halts creation, funding, release, and refund. Use only to stop the bleeding
  during an incident — it blocks settlement for honest users too.
