// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IFtsoV2Minimal, FtsoV2Compat} from "../interfaces/IFtsoV2Minimal.sol";

/**
 * @title MockFtsoV2
 * @notice Test-only FTSOv2 stand-in exposing the exact `getFeedByIdInWei` signature the escrow
 *         calls on the real Coston2 contract.
 */
contract MockFtsoV2 is IFtsoV2Minimal {
    uint256 public priceWei;
    uint64 public priceTimestamp;
    bool public shouldRevert;

    /// @notice Counts calls so tests can prove the escrow reads the feed on-chain rather than
    ///         trusting a caller-supplied price.
    uint256 public callCount;

    constructor(uint256 initialPriceWei, uint64 initialTimestamp) {
        priceWei = initialPriceWei;
        priceTimestamp = initialTimestamp;
    }

    function setPrice(uint256 newPriceWei, uint64 newTimestamp) external {
        priceWei = newPriceWei;
        priceTimestamp = newTimestamp;
    }

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function getFeedByIdInWei(
        bytes21
    ) external payable override returns (uint256 _value, uint64 _timestamp) {
        require(!shouldRevert, "MockFtsoV2: forced revert");
        callCount += 1;
        return (priceWei, priceTimestamp);
    }
}

/**
 * @title FtsoSelectorProbe
 * @notice Exposes {FtsoV2Compat} so a unit test can assert the minimal interface still matches the
 *         official Flare periphery interface after a dependency bump.
 */
contract FtsoSelectorProbe {
    function officialSelector() external pure returns (bytes4) {
        return FtsoV2Compat.officialSelector();
    }

    function minimalSelector() external pure returns (bytes4) {
        return FtsoV2Compat.minimalSelector();
    }
}
