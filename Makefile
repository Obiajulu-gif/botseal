.PHONY: help install check-env contracts-compile contracts-test contracts-coverage \
        contracts-resolve contracts-deploy contracts-configure-tee contracts-smoke \
        sync-abi smoke fcc-start fcc-stop fcc-test fcc-unit web-dev web-build web-test \
        web-lint web-typecheck verify clean

help:
	@echo "FlareSeal"
	@echo ""
	@echo "  make install                 Install contract and web dependencies"
	@echo "  make check-env               Report which environment variables are set"
	@echo "  make smoke                   Dependency-free Coston2 connectivity check"
	@echo ""
	@echo "  make contracts-test          Run the Hardhat test suite"
	@echo "  make contracts-coverage      Solidity coverage report"
	@echo "  make contracts-resolve       Resolve FXRP and FTSOv2 from the registry"
	@echo "  make contracts-deploy        Deploy FlareSealEscrow to Coston2"
	@echo "  make contracts-configure-tee Set the TEE signing address on the escrow"
	@echo "  make contracts-smoke         On-chain checks against the deployed escrow"
	@echo ""
	@echo "  make sync-abi                Copy compiled ABIs into web/lib/abi"
	@echo ""
	@echo "  make fcc-start / fcc-stop    Start or stop the FCC Docker stack"
	@echo "  make fcc-unit                FCC extension unit tests (no Docker)"
	@echo "  make fcc-test                FCC end-to-end test (needs the stack + chain)"
	@echo ""
	@echo "  make web-dev / web-build     Run or build the frontend"
	@echo "  make verify                  Every offline gate: tests, lint, types, build"

install:
	cd contracts && npm install
	cd web && npm install

check-env:
	node scripts/check-env.mjs

smoke:
	node scripts/smoke-coston2.mjs

# --- Contracts --------------------------------------------------------------

contracts-compile:
	cd contracts && npm run compile

contracts-test:
	cd contracts && npm test

contracts-coverage:
	cd contracts && npm run coverage

contracts-resolve:
	cd contracts && npm run resolve:coston2

contracts-deploy:
	cd contracts && npm run deploy:coston2

contracts-configure-tee:
	cd contracts && npm run configure-tee:coston2

contracts-smoke:
	cd contracts && npm run smoke:coston2

# --- ABI ---------------------------------------------------------------------

# Compiles both contracts first so the ABIs cannot go stale.
sync-abi:
	cd contracts && npm run compile && npm run compile:fcc
	node scripts/sync-abi.mjs

# --- FCC ---------------------------------------------------------------------

fcc-start:
	cd fcc && ./scripts/start-services.sh

fcc-stop:
	cd fcc && ./scripts/stop-services.sh

fcc-unit:
	cd fcc && ./scripts/test-unit.sh typescript

fcc-test:
	cd fcc && ./scripts/test.sh

# --- Web ---------------------------------------------------------------------

web-dev:
	cd web && npm run dev

web-build:
	cd web && npm run build

web-test:
	cd web && npm test

web-lint:
	cd web && npm run lint

web-typecheck:
	cd web && npm run typecheck

# --- Gates -------------------------------------------------------------------

# Everything that runs without a chain, a wallet, or Docker.
verify:
	cd contracts && npm test
	cd fcc/typescript && npx vitest run
	cd web && npm run lint
	cd web && npm run typecheck
	cd web && npm test
	cd web && npm run build

clean:
	cd contracts && npm run clean
	rm -rf web/.next
