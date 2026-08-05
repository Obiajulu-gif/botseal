package utils

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"time"

	"extension-scaffold/tools/pkg/fccutils"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto/ecies"
	"github.com/pkg/errors"
)

// PrivateInvoiceItem mirrors the browser-side line item. Numeric fields are decimal strings so no
// JSON parser anywhere in the chain can round them.
type PrivateInvoiceItem struct {
	Description    string `json:"description"`
	Quantity       string `json:"quantity"`
	UnitPriceCents string `json:"unitPriceCents"`
}

// PrivateInvoicePayload is the plaintext that never leaves the TEE.
type PrivateInvoicePayload struct {
	Version          int                  `json:"version"`
	Seller           string               `json:"seller"`
	Buyer            string               `json:"buyer"`
	EscrowContract   string               `json:"escrowContract"`
	InvoiceReference string               `json:"invoiceReference"`
	DueAt            int64                `json:"dueAt"`
	Currency         string               `json:"currency"`
	Items            []PrivateInvoiceItem `json:"items"`
	DiscountCents    string               `json:"discountCents"`
	TaxCents         string               `json:"taxCents"`
	Nonce            string               `json:"nonce"`
	Salt             string               `json:"salt"`
}

// RandomSecret returns 32 bytes of hex-encoded entropy, matching what the browser generates with
// crypto.getRandomValues.
func RandomSecret() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", errors.Errorf("failed to generate entropy: %s", err)
	}
	return hex.EncodeToString(buf), nil
}

// NewTestInvoice builds a valid two-line-item invoice due 30 days out.
//
// 2 x $50.00 + 1 x $125.50 = $225.50 subtotal, minus $5.00 discount, plus $18.04 tax
// = $238.54 -> 23854 cents.
func NewTestInvoice(seller, buyer, escrow common.Address) (*PrivateInvoicePayload, *big.Int, error) {
	nonce, err := RandomSecret()
	if err != nil {
		return nil, nil, err
	}
	salt, err := RandomSecret()
	if err != nil {
		return nil, nil, err
	}

	return &PrivateInvoicePayload{
		Version:          1,
		Seller:           seller.Hex(),
		Buyer:            buyer.Hex(),
		EscrowContract:   escrow.Hex(),
		InvoiceReference: "FS-E2E-0001",
		DueAt:            time.Now().Add(30 * 24 * time.Hour).Unix(),
		Currency:         "USD",
		Items: []PrivateInvoiceItem{
			{Description: "Protocol integration retainer", Quantity: "2", UnitPriceCents: "5000"},
			{Description: "Security review", Quantity: "1", UnitPriceCents: "12550"},
		},
		DiscountCents: "500",
		TaxCents:      "1804",
		Nonce:         nonce,
		Salt:          salt,
	}, big.NewInt(23854), nil
}

// EncryptToTee ECIES-encrypts the payload to the TEE's public key, exactly as the browser does.
//
// The scheme is fixed by tee-node: go-ethereum crypto/ecies with ECIES_AES128_SHA256 over
// secp256k1 and no shared info (see tee-node pkg/utils/crypto.go, Encrypt).
func EncryptToTee(proxyURL string, payload *PrivateInvoicePayload) ([]byte, error) {
	plaintext, err := json.Marshal(payload)
	if err != nil {
		return nil, errors.Errorf("failed to marshal invoice: %s", err)
	}

	info, err := fccutils.TeeInfo(proxyURL)
	if err != nil {
		return nil, errors.Errorf("failed to read TEE info from %s/info: %s", proxyURL, err)
	}

	pub := &ecies.PublicKey{
		X:      info.TeeInfo.PublicKey.X.Big(),
		Y:      info.TeeInfo.PublicKey.Y.Big(),
		Curve:  ecies.DefaultCurve,
		Params: ecies.ECIES_AES128_SHA256,
	}

	ciphertext, err := ecies.Encrypt(rand.Reader, pub, plaintext, nil, nil)
	if err != nil {
		return nil, errors.Errorf("ECIES encryption failed: %s", err)
	}
	return ciphertext, nil
}

// DecodedInvoiceResult is the public result the TEE returns and the escrow consumes.
type DecodedInvoiceResult struct {
	Seller          common.Address
	Buyer           common.Address
	EscrowContract  common.Address
	UsdAmountCents  *big.Int
	DueAt           uint64
	TermsCommitment common.Hash
}

// DecodeInvoiceResult parses ActionResult.Data using the exact schema the escrow decodes:
// (address,address,address,uint256,uint64,bytes32) as a flat parameter list.
func DecodeInvoiceResult(data []byte) (*DecodedInvoiceResult, error) {
	addressT, _ := abi.NewType("address", "", nil)
	uint256T, _ := abi.NewType("uint256", "", nil)
	uint64T, _ := abi.NewType("uint64", "", nil)
	bytes32T, _ := abi.NewType("bytes32", "", nil)

	args := abi.Arguments{
		{Type: addressT}, {Type: addressT}, {Type: addressT},
		{Type: uint256T}, {Type: uint64T}, {Type: bytes32T},
	}

	values, err := args.Unpack(data)
	if err != nil {
		return nil, errors.Errorf("failed to decode result data: %s", err)
	}
	if len(values) != 6 {
		return nil, errors.Errorf("expected 6 result fields, got %d", len(values))
	}

	return &DecodedInvoiceResult{
		Seller:          values[0].(common.Address),
		Buyer:           values[1].(common.Address),
		EscrowContract:  values[2].(common.Address),
		UsdAmountCents:  values[3].(*big.Int),
		DueAt:           values[4].(uint64),
		TermsCommitment: common.Hash(values[5].([32]byte)),
	}, nil
}
