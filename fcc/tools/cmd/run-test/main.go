// Command run-test drives the full FlareSeal confidential invoice flow against a live chain and
// a running FCC stack.
//
// Sequence:
//  1. setExtensionId on the deployed FlareSealInstructionSender
//  2. fetch the TEE public key from the proxy /info endpoint
//  3. build a valid two-line-item private invoice
//  4. ECIES-encrypt it to the TEE
//  5. sendCreateInvoice on-chain
//  6. poll the proxy for the signed ActionResult
//  7. assert the TEE returned status 1 and the expected total
//  8. relay the exact signed bytes into FlareSealEscrow (when ESCROW_CONTRACT_ADDRESS is set)
//  9. read the created invoice back and assert every field
//
// Any failure is fatal. Nothing here is skipped silently.
package main

import (
	"context"
	"flag"
	"math/big"
	"os"
	"strings"
	"time"

	"extension-scaffold/tools/pkg/configs"
	"extension-scaffold/tools/pkg/contracts/escrow"
	"extension-scaffold/tools/pkg/fccutils"
	"extension-scaffold/tools/pkg/support"
	instrutils "extension-scaffold/tools/pkg/utils"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/flare-foundation/go-flare-common/pkg/logger"
	"github.com/pkg/errors"
)

func main() {
	af := flag.String("a", configs.AddressesFile, "file with deployed addresses")
	cf := flag.String("c", configs.ChainNodeURL, "chain node url")
	pf := flag.String("p", configs.ExtensionProxyURL, "extension proxy url")
	instructionSenderF := flag.String("instructionSender", "", "instructionSender address")
	escrowF := flag.String("escrow", os.Getenv("ESCROW_CONTRACT_ADDRESS"), "FlareSealEscrow address")
	buyerF := flag.String("buyer", os.Getenv("TEST_BUYER_ADDRESS"), "buyer address for the test invoice")
	flag.Parse()

	instructionSenderAddress := common.HexToAddress(*instructionSenderF)

	testSupport, err := support.DefaultSupport(*af, *cf)
	if err != nil {
		fccutils.FatalWithCause(err)
	}

	seller := crypto.PubkeyToAddress(testSupport.Prv.PublicKey)

	if !common.IsHexAddress(*escrowF) {
		fccutils.FatalWithCause(errors.New(
			"ESCROW_CONTRACT_ADDRESS (or -escrow) must be the deployed FlareSealEscrow address"))
	}
	escrowAddress := common.HexToAddress(*escrowF)

	// The buyer must differ from the seller; the TEE rejects an invoice where they match.
	buyer := common.HexToAddress("0x000000000000000000000000000000000000dEaD")
	if common.IsHexAddress(*buyerF) {
		buyer = common.HexToAddress(*buyerF)
	}
	if buyer == seller {
		fccutils.FatalWithCause(errors.New("buyer must differ from the seller"))
	}

	// --- Step 1: configure the contract --------------------------------------
	logger.Infof("Setting extension ID on instruction sender...")
	err = instrutils.SetExtensionId(testSupport, instructionSenderAddress)
	if err != nil {
		if strings.Contains(err.Error(), "already set") || strings.Contains(err.Error(), "Extension ID already set") {
			logger.Infof("Extension ID already set on contract, continuing")
		} else {
			logger.Errorf("setExtensionId failed: %s", err)
			fccutils.FatalWithCause(errors.Errorf(
				"setExtensionId failed — is the extension registered? Check that pre-build.sh completed successfully. Error: %s", err))
		}
	}

	// --- Steps 2-4: build and encrypt the private invoice --------------------
	logger.Infof("Building private invoice (seller=%s buyer=%s escrow=%s)",
		seller.Hex(), buyer.Hex(), escrowAddress.Hex())

	payload, expectedTotalCents, err := instrutils.NewTestInvoice(seller, buyer, escrowAddress)
	if err != nil {
		fccutils.FatalWithCause(err)
	}

	// Note: the plaintext is never logged. Only its ciphertext length, which is public anyway.
	ciphertext, err := instrutils.EncryptToTee(*pf, payload)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	logger.Infof("Encrypted invoice payload: %d bytes of ciphertext", len(ciphertext))

	// --- Step 5: submit on-chain ---------------------------------------------
	logger.Infof("Sending INVOICE/CREATE instruction...")
	instructionID, txHash, err := instrutils.SendCreateInvoice(testSupport, instructionSenderAddress, ciphertext)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	logger.Infof("Instruction sent. actionId=%s tx=%s", instructionID.Hex(), txHash.Hex())

	time.Sleep(5 * time.Second)

	// --- Steps 6-7: poll for the signed result -------------------------------
	actionResponse, err := fccutils.ActionResult(*pf, instructionID)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	result := actionResponse.Result

	if result.Status == 2 {
		fccutils.FatalWithCause(errors.New("instruction still pending after polling, expected completed"))
	}
	if result.Status == 0 {
		fccutils.FatalWithCause(errors.Errorf("TEE rejected the invoice: %s", result.Log))
	}
	if result.Status != 1 {
		fccutils.FatalWithCause(errors.Errorf("unexpected result status: %d", result.Status))
	}
	if len(result.Data) == 0 {
		fccutils.FatalWithCause(errors.New("expected ABI-encoded result data but got none"))
	}
	if len(actionResponse.Signature) != 65 {
		fccutils.FatalWithCause(errors.Errorf(
			"expected a 65-byte TEE signature, got %d bytes", len(actionResponse.Signature)))
	}

	decoded, err := instrutils.DecodeInvoiceResult(result.Data)
	if err != nil {
		fccutils.FatalWithCause(err)
	}

	if decoded.Seller != seller {
		fccutils.FatalWithCause(errors.Errorf("result seller mismatch: got %s want %s", decoded.Seller.Hex(), seller.Hex()))
	}
	if decoded.Buyer != buyer {
		fccutils.FatalWithCause(errors.Errorf("result buyer mismatch: got %s want %s", decoded.Buyer.Hex(), buyer.Hex()))
	}
	if decoded.EscrowContract != escrowAddress {
		fccutils.FatalWithCause(errors.Errorf("result escrow mismatch: got %s want %s", decoded.EscrowContract.Hex(), escrowAddress.Hex()))
	}
	if decoded.UsdAmountCents.Cmp(expectedTotalCents) != 0 {
		fccutils.FatalWithCause(errors.Errorf(
			"total mismatch: TEE computed %s cents, expected %s cents",
			decoded.UsdAmountCents, expectedTotalCents))
	}
	if decoded.TermsCommitment == (common.Hash{}) {
		fccutils.FatalWithCause(errors.New("terms commitment is zero"))
	}
	logger.Infof("TEE result verified: total=%s cents commitment=%s",
		decoded.UsdAmountCents, decoded.TermsCommitment.Hex())

	// --- Steps 8-9: relay into the escrow and read it back -------------------
	logger.Infof("Relaying signed result into FlareSealEscrow at %s...", escrowAddress.Hex())

	sealEscrow, err := escrow.NewFlareSealEscrow(escrowAddress, testSupport.ChainClient)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("failed to bind escrow: %s", err))
	}

	opts, err := bind.NewKeyedTransactorWithChainID(testSupport.Prv, testSupport.ChainID)
	if err != nil {
		fccutils.FatalWithCause(err)
	}

	// The exact bytes returned by the proxy are relayed unmodified. Re-encoding any of these
	// fields would change ActionResult.Hash() and the signature check would fail.
	relayTx, err := sealEscrow.RelayConfidentialInvoice(
		opts,
		result.Data,
		result.ID,
		string(result.SubmissionTag),
		result.Status,
		actionResponse.Signature,
	)
	if err != nil {
		reason := fccutils.DecodeRevertReason(err)
		if reason != "" {
			fccutils.FatalWithCause(errors.Errorf("relay failed: %s (revert: %s)", err, reason))
		}
		fccutils.FatalWithCause(errors.Errorf("relay failed: %s", err))
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	receipt, err := bind.WaitMined(ctx, testSupport.ChainClient, relayTx)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("relay tx not mined: %s", err))
	}
	if receipt.Status != 1 {
		fccutils.FatalWithCause(errors.Errorf("relay tx reverted: %s", relayTx.Hash().Hex()))
	}
	logger.Infof("Relay confirmed. tx=%s", relayTx.Hash().Hex())

	// Read the created invoice back from chain.
	nextID, err := sealEscrow.NextInvoiceId(nil)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	invoiceID := new(big.Int).Sub(nextID, big.NewInt(1))

	invoice, err := sealEscrow.GetInvoice(nil, invoiceID)
	if err != nil {
		fccutils.FatalWithCause(err)
	}

	switch {
	case invoice.Seller != seller:
		fccutils.FatalWithCause(errors.Errorf("stored seller mismatch: %s", invoice.Seller.Hex()))
	case invoice.Buyer != buyer:
		fccutils.FatalWithCause(errors.Errorf("stored buyer mismatch: %s", invoice.Buyer.Hex()))
	case invoice.UsdAmountCents.Cmp(expectedTotalCents) != 0:
		fccutils.FatalWithCause(errors.Errorf("stored total mismatch: %s", invoice.UsdAmountCents))
	case invoice.TermsCommitment == [32]byte{}:
		fccutils.FatalWithCause(errors.New("stored commitment is zero"))
	case !invoice.Confidential:
		fccutils.FatalWithCause(errors.New("invoice is not marked confidential"))
	case invoice.Status != 1: // Pending
		fccutils.FatalWithCause(errors.Errorf("expected Pending status, got %d", invoice.Status))
	case common.Hash(invoice.FccActionId) != result.ID:
		fccutils.FatalWithCause(errors.Errorf("stored action id mismatch: %x", invoice.FccActionId))
	}

	consumed, err := sealEscrow.ConsumedFccActionIds(nil, result.ID)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	if !consumed {
		fccutils.FatalWithCause(errors.New("action id was not marked consumed"))
	}

	logger.Infof("Invoice #%s created on-chain, confidential=%t, total=%s cents",
		invoiceID, invoice.Confidential, invoice.UsdAmountCents)
	logger.Infof("All tests passed.")
}
