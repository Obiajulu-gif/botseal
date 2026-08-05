// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// TODO: Replace local interfaces with imports from flare-smart-contracts-v2 once published as a package.
import { ITeeExtensionRegistry } from "./interfaces/ITeeExtensionRegistry.sol";
import { ITeeMachineRegistry } from "./interfaces/ITeeMachineRegistry.sol";

/// @title FlareSealInstructionSender
/// @notice On-chain entry point for FlareSeal confidential invoice creation.
///
/// The `_encryptedPayload` argument is an ECIES ciphertext produced in the browser against the
/// TEE's public key (from the FCC proxy `/info` endpoint). It is opaque to this contract and to
/// every observer of the chain; only the TEE can read it.
///
/// DO NOT MODIFY: constructor, setExtensionId(), _getExtensionId()
contract FlareSealInstructionSender {
    /// @notice Operation type for invoice actions.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_TYPE_INVOICE = bytes32("INVOICE");

    /// @notice Command for the CREATE action.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_COMMAND_CREATE = bytes32("CREATE");

    /// @notice Reference to the TEE extension registry contract.
    ITeeExtensionRegistry public immutable TEE_EXTENSION_REGISTRY;
    /// @notice Reference to the TEE machine registry contract.
    ITeeMachineRegistry public immutable TEE_MACHINE_REGISTRY;

    /// @notice First public extension ID. The registry reserves IDs below this
    /// for system/reserved extensions; public extensions are assigned from here up.
    uint256 private constant FIRST_PUBLIC_EXTENSION_ID = 0x10000; // 65536

    uint256 private _extensionId;

    /// @notice Thrown when the caller submits an empty ciphertext.
    error EmptyEncryptedPayload();

    /// @notice Emitted once the registry has accepted the instruction.
    /// @param actionId The instruction id, used to poll the FCC proxy for the signed result.
    /// @param requester The address that submitted the request (and the claim-back address).
    event ConfidentialInvoiceRequested(bytes32 indexed actionId, address indexed requester);

    /// @notice Initializes the contract with registry addresses.
    /// @param _teeExtensionRegistry Address of the TEE extension registry.
    /// @param _teeMachineRegistry Address of the TEE machine registry.
    constructor(
        ITeeExtensionRegistry _teeExtensionRegistry,
        ITeeMachineRegistry _teeMachineRegistry
    ) {
        require(address(_teeExtensionRegistry) != address(0), "TeeExtensionRegistry cannot be zero address");
        require(address(_teeMachineRegistry) != address(0), "TeeMachineRegistry cannot be zero address");
        require(address(_teeExtensionRegistry).code.length > 0, "TeeExtensionRegistry has no code");
        require(address(_teeMachineRegistry).code.length > 0, "TeeMachineRegistry has no code");
        TEE_EXTENSION_REGISTRY = _teeExtensionRegistry;
        TEE_MACHINE_REGISTRY = _teeMachineRegistry;
    }

    /// @notice Finds and sets this contract's extension id. Can only be set once.
    /// DO NOT MODIFY this function.
    function setExtensionId() external {
        require(_extensionId == 0, "Extension ID already set.");

        uint256 c = TEE_EXTENSION_REGISTRY.nextPublicExtensionId();
        for (uint256 i = FIRST_PUBLIC_EXTENSION_ID; i < c; ++i) {
            if (TEE_EXTENSION_REGISTRY.getTeeExtensionInstructionsSender(i) == address(this)) {
                _extensionId = i;
                return;
            }
        }
        revert("Extension ID not found.");
    }

    /// @notice Submits an encrypted invoice to the TEE for validation and signing.
    /// @param _encryptedPayload ECIES ciphertext of the private invoice JSON, encrypted to the
    ///        TEE public key. Never plaintext.
    /// @return instructionId The action id to poll for the signed result.
    function sendCreateInvoice(
        bytes calldata _encryptedPayload
    ) external payable returns (bytes32 instructionId) {
        if (_encryptedPayload.length == 0) revert EmptyEncryptedPayload();

        address[] memory teeIds = TEE_MACHINE_REGISTRY.getRandomTeeIds(_getExtensionId(), 1);
        address[] memory cosigners = new address[](0);

        ITeeExtensionRegistry.TeeInstructionParams memory params = ITeeExtensionRegistry.TeeInstructionParams({
            opType: OP_TYPE_INVOICE,
            opCommand: OP_COMMAND_CREATE,
            message: _encryptedPayload,
            cosigners: cosigners,
            cosignersThreshold: 0,
            claimBackAddress: msg.sender
        });

        instructionId = TEE_EXTENSION_REGISTRY.sendInstructions{value: msg.value}(
            teeIds,
            params
        );

        emit ConfidentialInvoiceRequested(instructionId, msg.sender);
    }

    /// @notice Returns the cached extension ID, reverting if not yet set.
    /// @return The extension ID assigned to this contract.
    function _getExtensionId() internal view returns (uint256) {
        require(_extensionId != 0, "Extension ID is not set.");
        return _extensionId;
    }
}
