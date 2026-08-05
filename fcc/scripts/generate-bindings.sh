#!/usr/bin/env bash
# generate-bindings.sh — Compile Solidity contracts and generate Go bindings.
#
# Prerequisites: forge (Foundry), jq
#
# No Foundry? The same two inputs can be produced with the Hardhat toolchain already installed in
# ../contracts:
#
#     cd ../contracts && npm run compile && npm run compile:fcc && npm run export-fcc-bindings
#     cd ../fcc/tools && go generate ./pkg/contracts/...
#
# Usage: ./scripts/generate-bindings.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Contract name and Go package ---
CONTRACT_NAME="FlareSealInstructionSender"
GO_PKG="flareseal"
BINDINGS_DIR="$PROJECT_DIR/tools/pkg/contracts/$GO_PKG"

# --- Escrow bindings (ABI only; Go binds to a deployed instance, never deploys one) ---
ESCROW_NAME="FlareSealEscrow"
ESCROW_PKG="escrow"
ESCROW_DIR="$PROJECT_DIR/tools/pkg/contracts/$ESCROW_PKG"
ESCROW_ARTIFACT="$PROJECT_DIR/../contracts/artifacts/contracts/FlareSealEscrow.sol/FlareSealEscrow.json"

# Hardhat's equivalent of the forge artifact, produced by `npm run compile:fcc` in ../contracts.
HARDHAT_OUT="$PROJECT_DIR/artifacts-hardhat/fcc/contracts/InstructionSender.sol/${CONTRACT_NAME}.json"

cd "$PROJECT_DIR"

# Verify the contract name in the source matches what we expect
if ! grep -q "contract ${CONTRACT_NAME}" "$PROJECT_DIR/contracts/InstructionSender.sol" 2>/dev/null; then
    echo ""
    echo "ERROR: Contract name '${CONTRACT_NAME}' not found in contracts/InstructionSender.sol."
    echo "Make sure the contract name in InstructionSender.sol matches CONTRACT_NAME in this script."
    exit 1
fi

mkdir -p "$BINDINGS_DIR"

# --- Steps 1-2: compile, then extract ABI and BIN --------------------------------
#
# Foundry is preferred, but it is not a hard requirement: the same contract is
# compiled by ../contracts/hardhat.fcc.config.ts with identical solc settings.
# Falling back keeps this pipeline usable on machines without Foundry (notably
# WSL, where the FCC stack runs) instead of failing at step 0.
#
# The two toolchains nest bytecode differently: forge writes `.bytecode.object`,
# Hardhat writes `.bytecode`.
if command -v forge >/dev/null 2>&1; then
    echo "=== Steps 1-2: Compile with forge and extract ABI/BIN ==="
    forge build

    FORGE_OUT="$PROJECT_DIR/out/InstructionSender.sol/${CONTRACT_NAME}.json"
    if [[ ! -f "$FORGE_OUT" ]]; then
        echo "ERROR: forge output not found at $FORGE_OUT"
        echo "Check that CONTRACT_NAME matches your Solidity contract name."
        exit 1
    fi

    jq '.abi' "$FORGE_OUT" > "$BINDINGS_DIR/${CONTRACT_NAME}.abi"
    jq -r '.bytecode.object' "$FORGE_OUT" | sed 's/^0x//' > "$BINDINGS_DIR/${CONTRACT_NAME}.bin"
elif [[ -f "$HARDHAT_OUT" ]]; then
    echo "=== Steps 1-2: forge not found — using the Hardhat artifact ==="
    echo "  $HARDHAT_OUT"

    jq '.abi' "$HARDHAT_OUT" > "$BINDINGS_DIR/${CONTRACT_NAME}.abi"
    jq -r '.bytecode' "$HARDHAT_OUT" | sed 's/^0x//' > "$BINDINGS_DIR/${CONTRACT_NAME}.bin"
else
    echo "ERROR: neither forge nor a Hardhat artifact is available."
    echo "Install Foundry, or build the artifact with:"
    echo "    cd ../contracts && npm run compile:fcc"
    exit 1
fi

echo "  ABI → $BINDINGS_DIR/${CONTRACT_NAME}.abi"
echo "  BIN → $BINDINGS_DIR/${CONTRACT_NAME}.bin"

echo "=== Step 3: Extract escrow ABI ==="
if [[ ! -f "$ESCROW_ARTIFACT" ]]; then
    echo "ERROR: escrow artifact not found at $ESCROW_ARTIFACT"
    echo "Run 'npm run compile' in ../contracts first — run-test relays results into the escrow."
    exit 1
fi
mkdir -p "$ESCROW_DIR"
jq '.abi' "$ESCROW_ARTIFACT" > "$ESCROW_DIR/${ESCROW_NAME}.abi"
echo "  ABI → $ESCROW_DIR/${ESCROW_NAME}.abi"

echo "=== Step 4: Generate Go bindings ==="
cd "$PROJECT_DIR/tools"
go generate ./pkg/contracts/...

echo "=== Done ==="
echo "Generated: $BINDINGS_DIR/autogen.go"
echo "Generated: $ESCROW_DIR/autogen.go"
