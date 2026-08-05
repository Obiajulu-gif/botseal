// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {IFtsoV2Minimal} from "./interfaces/IFtsoV2Minimal.sol";

/**
 * @title FlareSealEscrow
 * @notice Confidential invoice escrow settled in FXRP on Flare Testnet Coston2.
 *
 * @dev Privacy model. Invoice line items, descriptions, customer identities, tax identifiers,
 *      the nonce and the salt never touch this contract. They are encrypted in the browser to the
 *      Flare Confidential Compute (FCC) extension public key, processed inside the TEE, and only a
 *      minimal public result is returned: seller, buyer, escrow address, total in USD cents, due
 *      date, and a `termsCommitment` binding the full private terms. This contract stores and emits
 *      only that public result.
 *
 * @dev Economic model. Invoices are denominated in USD cents. At funding time the contract reads
 *      XRP/USD from FTSOv2 on-chain and converts to FXRP token units with ceiling rounding. The
 *      frontend never supplies a price or an amount that the contract trusts; it only supplies a
 *      `maxFxrpAmount` slippage ceiling.
 */
contract FlareSealEscrow is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum InvoiceStatus {
        None,
        Pending,
        Funded,
        Released,
        Refunded,
        Cancelled
    }

    struct Invoice {
        uint256 id;
        address seller;
        address buyer;
        bytes32 termsCommitment;
        bytes32 fccActionId;
        uint256 usdAmountCents;
        uint256 fxrpAmount;
        uint256 xrpUsdPriceWei;
        uint64 dueAt;
        uint64 createdAt;
        uint64 fundedAt;
        uint64 settledAt;
        bool confidential;
        InvoiceStatus status;
    }

    /// @dev The decoded FCC `ActionResult.Data` payload. Held in memory purely to keep
    ///      `relayConfidentialInvoice` within the EVM's 16-slot stack limit.
    struct ConfidentialResult {
        address seller;
        address buyer;
        address escrowContract;
        uint256 usdAmountCents;
        uint64 dueAt;
        bytes32 termsCommitment;
    }

    // ---------------------------------------------------------------------
    // Constants and immutables
    // ---------------------------------------------------------------------

    /// @notice Official FTSOv2 feed identifier for XRP/USD.
    bytes21 public constant XRP_USD_FEED_ID = 0x015852502f55534400000000000000000000000000;

    /// @dev Domain separator required by the Flare FCC TEE signature scheme.
    bytes32 private constant TEE_ACTION_RESULT_PREFIX = bytes32("TEE_ACTION_RESULT");

    /// @dev A USD cent expressed with 18 decimals: 1 cent == 1e16 wei-USD.
    uint256 private constant CENTS_TO_WEI_USD = 1e16;

    /// @dev Guards against a mispriced feed being accepted as "fresh forever".
    uint256 private constant MAX_ALLOWED_PRICE_AGE = 24 hours;

    IERC20Metadata public immutable FXRP;
    IFtsoV2Minimal public immutable FTSO_V2;

    /// @notice `10 ** FXRP.decimals()`, cached at construction so funding cannot be re-priced by
    ///         a token that changes its reported decimals.
    uint256 public immutable fxrpScale;

    /// @notice Maximum accepted age, in seconds, of an FTSOv2 XRP/USD observation.
    uint256 public immutable maxPriceAge;

    /// @notice Extra time after `dueAt` before a buyer may unilaterally reclaim a funded escrow.
    uint256 public immutable refundGracePeriod;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    uint256 public nextInvoiceId = 1;
    uint256 public totalEscrowed;

    /// @notice The TEE signing address reported by the FCC proxy `/info` endpoint.
    address public teeAddress;

    mapping(uint256 => Invoice) private invoices;
    mapping(bytes32 => bool) public consumedFccActionIds;
    mapping(address => uint256[]) private sellerInvoiceIds;
    mapping(address => uint256[]) private buyerInvoiceIds;

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error NotAContract();
    error InvalidAmount();
    error InvalidDueDate();
    error InvalidCommitment();
    error InvoiceNotFound();
    error InvalidStatus();
    error NotSeller();
    error NotBuyer();
    error InvoiceExpired();
    error RefundNotAvailable();
    error StalePrice();
    error InvalidPrice();
    error SlippageExceeded();
    error TeeNotConfigured();
    error TeeReportedFailure();
    error InvalidTeeSignature();
    error FccActionAlreadyConsumed();
    error ResultForWrongContract();
    error InvalidResultSeller();
    error InvalidActionId();
    error InvalidMaxPriceAge();
    error UnsupportedTokenDecimals();
    error SameSellerAndBuyer();
    error CannotRecoverEscrowToken();

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event InvoiceCreated(
        uint256 indexed invoiceId,
        address indexed seller,
        address indexed buyer,
        bytes32 termsCommitment,
        uint256 usdAmountCents,
        uint64 dueAt,
        bool confidential,
        bytes32 fccActionId
    );

    event InvoiceFunded(
        uint256 indexed invoiceId,
        address indexed buyer,
        uint256 fxrpAmount,
        uint256 xrpUsdPriceWei
    );

    event InvoiceReleased(uint256 indexed invoiceId, address indexed seller, uint256 fxrpAmount);

    event InvoiceRefunded(
        uint256 indexed invoiceId,
        address indexed buyer,
        uint256 fxrpAmount,
        bool expiredRefund
    );

    event InvoiceCancelled(uint256 indexed invoiceId);

    event TeeAddressUpdated(address indexed previousAddress, address indexed newAddress);

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    constructor(
        address initialOwner,
        address fxrp,
        address ftsoV2,
        uint256 maxPriceAgeSeconds,
        uint256 refundGracePeriodSeconds
    ) Ownable(initialOwner) {
        if (fxrp == address(0) || ftsoV2 == address(0)) revert ZeroAddress();
        if (fxrp.code.length == 0 || ftsoV2.code.length == 0) revert NotAContract();
        if (maxPriceAgeSeconds == 0 || maxPriceAgeSeconds > MAX_ALLOWED_PRICE_AGE) {
            revert InvalidMaxPriceAge();
        }

        uint8 tokenDecimals = IERC20Metadata(fxrp).decimals();
        if (tokenDecimals > 18) revert UnsupportedTokenDecimals();

        FXRP = IERC20Metadata(fxrp);
        FTSO_V2 = IFtsoV2Minimal(ftsoV2);
        fxrpScale = 10 ** tokenDecimals;
        maxPriceAge = maxPriceAgeSeconds;
        refundGracePeriod = refundGracePeriodSeconds;
    }

    // ---------------------------------------------------------------------
    // Invoice creation - public fallback mode
    // ---------------------------------------------------------------------

    /**
     * @notice Creates a non-confidential invoice directly, bypassing FCC.
     * @dev Demo-continuity path used when the FCC service stack is unavailable. The commitment is
     *      supplied by the caller and is NOT validated by a TEE, so a public invoice proves only
     *      that the seller asserted these terms.
     */
    function createPublicInvoice(
        address buyer,
        bytes32 termsCommitment,
        uint256 usdAmountCents,
        uint64 dueAt
    ) external whenNotPaused returns (uint256 invoiceId) {
        return
            _createInvoice(
                msg.sender,
                buyer,
                termsCommitment,
                usdAmountCents,
                dueAt,
                false,
                bytes32(0)
            );
    }

    // ---------------------------------------------------------------------
    // Invoice creation - confidential FCC relay
    // ---------------------------------------------------------------------

    /**
     * @notice Relays a TEE-signed FCC `ActionResult` and creates the corresponding invoice.
     *
     * @param resultData    The exact `ActionResult.Data` bytes returned by the FCC proxy. These are
     *                      hashed as received; they are never re-encoded before verification.
     * @param actionId      The FCC action identifier. Single-use across the lifetime of this contract.
     * @param submissionTag The FCC submission tag string, verbatim from the proxy.
     * @param status        FCC result status. Only `1` (success) is accepted.
     * @param signature     65-byte TEE signature over the domain-separated, EIP-191-wrapped digest.
     *
     * @dev `resultData` must ABI-decode as:
     *      (address seller, address buyer, address escrowContract, uint256 usdAmountCents,
     *       uint64 dueAt, bytes32 termsCommitment)
     */
    function relayConfidentialInvoice(
        bytes calldata resultData,
        bytes32 actionId,
        string calldata submissionTag,
        uint8 status,
        bytes calldata signature
    ) external whenNotPaused returns (uint256 invoiceId) {
        if (teeAddress == address(0)) revert TeeNotConfigured();
        if (status != 1) revert TeeReportedFailure();
        if (actionId == bytes32(0)) revert InvalidActionId();
        if (consumedFccActionIds[actionId]) revert FccActionAlreadyConsumed();

        _verifyTeeSignature(resultData, actionId, submissionTag, status, signature);

        ConfidentialResult memory result = _decodeResult(resultData);

        if (result.escrowContract != address(this)) revert ResultForWrongContract();
        if (result.seller != msg.sender) revert InvalidResultSeller();

        consumedFccActionIds[actionId] = true;

        return
            _createInvoice(
                result.seller,
                result.buyer,
                result.termsCommitment,
                result.usdAmountCents,
                result.dueAt,
                true,
                actionId
            );
    }

    /**
     * @dev Reconstructs `ActionResult.Hash()`, applies the Flare FCC domain separation and the
     *      EIP-191 personal-sign wrapper, then requires the recovered signer to be {teeAddress}.
     *      `resultData` is hashed exactly as received - never re-encoded.
     */
    function _verifyTeeSignature(
        bytes calldata resultData,
        bytes32 actionId,
        string calldata submissionTag,
        uint8 status,
        bytes calldata signature
    ) private view {
        bytes32 resultHash = keccak256(
            abi.encodePacked(
                keccak256(resultData),
                actionId,
                keccak256(bytes(submissionTag)),
                status
            )
        );

        // Domain-separate, binding the signature to this chain.
        bytes32 payloadHash = keccak256(
            abi.encode(TEE_ACTION_RESULT_PREFIX, block.chainid, resultHash)
        );

        address recovered = ECDSA.recover(
            MessageHashUtils.toEthSignedMessageHash(payloadHash),
            signature
        );
        if (recovered != teeAddress) revert InvalidTeeSignature();
    }

    function _decodeResult(
        bytes calldata resultData
    ) private pure returns (ConfidentialResult memory result) {
        (
            result.seller,
            result.buyer,
            result.escrowContract,
            result.usdAmountCents,
            result.dueAt,
            result.termsCommitment
        ) = abi.decode(resultData, (address, address, address, uint256, uint64, bytes32));
    }

    // ---------------------------------------------------------------------
    // Pricing
    // ---------------------------------------------------------------------

    /**
     * @notice Returns the FXRP amount currently required to fund `invoiceId`.
     * @dev Not a view function: `FtsoV2Interface.getFeedByIdInWei` is `payable`. Frontends should
     *      call this through `eth_call` simulation rather than sending a transaction.
     */
    function quoteInvoice(
        uint256 invoiceId
    )
        external
        payable
        returns (uint256 requiredFxrp, uint256 xrpUsdPriceWei, uint64 priceTimestamp)
    {
        Invoice storage invoice = invoices[invoiceId];
        if (invoice.status == InvoiceStatus.None) revert InvoiceNotFound();
        if (invoice.status != InvoiceStatus.Pending) revert InvalidStatus();

        (xrpUsdPriceWei, priceTimestamp) = _readXrpUsdPrice();
        requiredFxrp = _usdCentsToFxrp(invoice.usdAmountCents, xrpUsdPriceWei);
    }

    // ---------------------------------------------------------------------
    // Settlement
    // ---------------------------------------------------------------------

    /**
     * @notice Buyer funds the escrow with FXRP priced at the live FTSOv2 XRP/USD rate.
     * @param maxFxrpAmount Slippage ceiling. The transaction reverts if the freshly computed
     *                      requirement exceeds this value.
     */
    function fundInvoice(
        uint256 invoiceId,
        uint256 maxFxrpAmount
    ) external nonReentrant whenNotPaused {
        Invoice storage invoice = invoices[invoiceId];
        if (invoice.status == InvoiceStatus.None) revert InvoiceNotFound();
        if (invoice.status != InvoiceStatus.Pending) revert InvalidStatus();
        if (msg.sender != invoice.buyer) revert NotBuyer();
        if (block.timestamp > invoice.dueAt) revert InvoiceExpired();

        (uint256 priceWei, ) = _readXrpUsdPrice();
        uint256 requiredFxrp = _usdCentsToFxrp(invoice.usdAmountCents, priceWei);
        if (requiredFxrp > maxFxrpAmount) revert SlippageExceeded();

        // Effects before interaction.
        invoice.fxrpAmount = requiredFxrp;
        invoice.xrpUsdPriceWei = priceWei;
        invoice.fundedAt = uint64(block.timestamp);
        invoice.status = InvoiceStatus.Funded;
        totalEscrowed += requiredFxrp;

        emit InvoiceFunded(invoiceId, msg.sender, requiredFxrp, priceWei);

        IERC20(address(FXRP)).safeTransferFrom(msg.sender, address(this), requiredFxrp);
    }

    /// @notice Buyer releases a funded escrow to the seller.
    function releasePayment(uint256 invoiceId) external nonReentrant whenNotPaused {
        Invoice storage invoice = invoices[invoiceId];
        if (invoice.status == InvoiceStatus.None) revert InvoiceNotFound();
        if (invoice.status != InvoiceStatus.Funded) revert InvalidStatus();
        if (msg.sender != invoice.buyer) revert NotBuyer();

        uint256 amount = invoice.fxrpAmount;
        address seller = invoice.seller;

        invoice.status = InvoiceStatus.Released;
        invoice.settledAt = uint64(block.timestamp);
        totalEscrowed -= amount;

        emit InvoiceReleased(invoiceId, seller, amount);

        IERC20(address(FXRP)).safeTransfer(seller, amount);
    }

    /// @notice Seller voluntarily returns a funded escrow to the buyer.
    function refundBuyer(uint256 invoiceId) external nonReentrant whenNotPaused {
        Invoice storage invoice = invoices[invoiceId];
        if (invoice.status == InvoiceStatus.None) revert InvoiceNotFound();
        if (invoice.status != InvoiceStatus.Funded) revert InvalidStatus();
        if (msg.sender != invoice.seller) revert NotSeller();

        uint256 amount = invoice.fxrpAmount;
        address buyer = invoice.buyer;

        invoice.status = InvoiceStatus.Refunded;
        invoice.settledAt = uint64(block.timestamp);
        totalEscrowed -= amount;

        emit InvoiceRefunded(invoiceId, buyer, amount, false);

        IERC20(address(FXRP)).safeTransfer(buyer, amount);
    }

    /**
     * @notice Buyer reclaims a funded escrow the seller never released.
     * @dev Available only after `dueAt + refundGracePeriod`, so a seller who delivered late still
     *      has a bounded window to be paid before the buyer can unwind the escrow.
     */
    function claimExpiredRefund(uint256 invoiceId) external nonReentrant whenNotPaused {
        Invoice storage invoice = invoices[invoiceId];
        if (invoice.status == InvoiceStatus.None) revert InvoiceNotFound();
        if (invoice.status != InvoiceStatus.Funded) revert InvalidStatus();
        if (msg.sender != invoice.buyer) revert NotBuyer();
        if (block.timestamp <= uint256(invoice.dueAt) + refundGracePeriod) {
            revert RefundNotAvailable();
        }

        uint256 amount = invoice.fxrpAmount;

        invoice.status = InvoiceStatus.Refunded;
        invoice.settledAt = uint64(block.timestamp);
        totalEscrowed -= amount;

        emit InvoiceRefunded(invoiceId, msg.sender, amount, true);

        IERC20(address(FXRP)).safeTransfer(msg.sender, amount);
    }

    /// @notice Seller cancels a pending, unfunded invoice.
    function cancelInvoice(uint256 invoiceId) external whenNotPaused {
        Invoice storage invoice = invoices[invoiceId];
        if (invoice.status == InvoiceStatus.None) revert InvoiceNotFound();
        if (invoice.status != InvoiceStatus.Pending) revert InvalidStatus();
        if (msg.sender != invoice.seller) revert NotSeller();

        invoice.status = InvoiceStatus.Cancelled;
        invoice.settledAt = uint64(block.timestamp);

        emit InvoiceCancelled(invoiceId);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getInvoice(uint256 invoiceId) external view returns (Invoice memory) {
        Invoice memory invoice = invoices[invoiceId];
        if (invoice.status == InvoiceStatus.None) revert InvoiceNotFound();
        return invoice;
    }

    function getSellerInvoiceIds(address seller) external view returns (uint256[] memory) {
        return sellerInvoiceIds[seller];
    }

    function getBuyerInvoiceIds(address buyer) external view returns (uint256[] memory) {
        return buyerInvoiceIds[buyer];
    }

    function invoiceExists(uint256 invoiceId) external view returns (bool) {
        return invoices[invoiceId].status != InvoiceStatus.None;
    }

    // ---------------------------------------------------------------------
    // Administration
    // ---------------------------------------------------------------------

    /**
     * @notice Sets the TEE signing address used to verify FCC results.
     * @dev Must be the address reported by the FCC proxy `/info` endpoint - not the proxy wallet,
     *      the extension owner, or the deployer. Rotating this address does not invalidate invoices
     *      that were already created.
     */
    function setTeeAddress(address newTeeAddress) external onlyOwner {
        if (newTeeAddress == address(0)) revert ZeroAddress();
        address previous = teeAddress;
        teeAddress = newTeeAddress;
        emit TeeAddressUpdated(previous, newTeeAddress);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Recovers tokens accidentally sent to this contract.
     * @dev FXRP is explicitly rejected: there is no path by which the owner can touch escrowed
     *      funds. Buyers' and sellers' FXRP is only ever movable by `releasePayment`,
     *      `refundBuyer`, or `claimExpiredRefund`.
     */
    function recoverUnsupportedToken(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(FXRP)) revert CannotRecoverEscrowToken();
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _createInvoice(
        address seller,
        address buyer,
        bytes32 termsCommitment,
        uint256 usdAmountCents,
        uint64 dueAt,
        bool confidential,
        bytes32 fccActionId
    ) private returns (uint256 invoiceId) {
        if (buyer == address(0)) revert ZeroAddress();
        if (buyer == seller) revert SameSellerAndBuyer();
        if (termsCommitment == bytes32(0)) revert InvalidCommitment();
        if (usdAmountCents == 0) revert InvalidAmount();
        if (dueAt <= block.timestamp) revert InvalidDueDate();

        invoiceId = nextInvoiceId++;

        invoices[invoiceId] = Invoice({
            id: invoiceId,
            seller: seller,
            buyer: buyer,
            termsCommitment: termsCommitment,
            fccActionId: fccActionId,
            usdAmountCents: usdAmountCents,
            fxrpAmount: 0,
            xrpUsdPriceWei: 0,
            dueAt: dueAt,
            createdAt: uint64(block.timestamp),
            fundedAt: 0,
            settledAt: 0,
            confidential: confidential,
            status: InvoiceStatus.Pending
        });

        sellerInvoiceIds[seller].push(invoiceId);
        buyerInvoiceIds[buyer].push(invoiceId);

        emit InvoiceCreated(
            invoiceId,
            seller,
            buyer,
            termsCommitment,
            usdAmountCents,
            dueAt,
            confidential,
            fccActionId
        );
    }

    /// @dev Single source of truth for FTSOv2 access and freshness policy.
    function _readXrpUsdPrice() private returns (uint256 priceWei, uint64 timestamp) {
        (priceWei, timestamp) = FTSO_V2.getFeedByIdInWei(XRP_USD_FEED_ID);

        if (priceWei == 0) revert InvalidPrice();
        if (timestamp > block.timestamp) revert InvalidPrice();
        if (block.timestamp - timestamp > maxPriceAge) revert StalePrice();
    }

    /**
     * @dev Converts integer USD cents to FXRP token units, rounding up so the escrow is never
     *      under-funded by truncation.
     *
     *      usdValueWei = cents * 1e16                (cents -> 18-decimal USD)
     *      amount      = ceil(usdValueWei * 10^dec / priceWei)
     */
    function _usdCentsToFxrp(
        uint256 usdAmountCents,
        uint256 priceWei
    ) private view returns (uint256) {
        uint256 usdValueWei = usdAmountCents * CENTS_TO_WEI_USD;
        return Math.mulDiv(usdValueWei, fxrpScale, priceWei, Math.Rounding.Ceil);
    }
}
