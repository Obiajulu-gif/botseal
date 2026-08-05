// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FtsoV2Interface} from "@flarenetwork/flare-periphery-contracts/coston2/FtsoV2Interface.sol";

/**
 * @title IFtsoV2Minimal
 * @notice The strict subset of the official Flare `FtsoV2Interface` that FlareSeal depends on.
 * @dev The official interface declares ~10 functions; the escrow only ever calls one of them.
 *      Declaring the minimal surface keeps mocks small without changing the wire format: the
 *      selector below is asserted equal to the official one by {FtsoV2Compat} and by
 *      `test/FlareSealEscrow.test.ts`, so the escrow is ABI-identical to a real FtsoV2 caller.
 *
 *      `getFeedByIdInWei` is `payable` on the official interface because a feed fee may apply.
 *      It is therefore NOT a view function and cannot be called from a `view` context.
 */
interface IFtsoV2Minimal {
    /**
     * @notice Returns the feed value normalised to 18 decimals plus its publication timestamp.
     * @param _feedId The 21-byte FTSOv2 feed identifier.
     * @return _value Feed value scaled to 18 decimals.
     * @return _timestamp Unix timestamp of the voting round the value was published in.
     */
    function getFeedByIdInWei(
        bytes21 _feedId
    ) external payable returns (uint256 _value, uint64 _timestamp);
}

/**
 * @title FtsoV2Compat
 * @notice Exposes both selectors so a unit test can prove the minimal interface has not drifted
 *         from the official Flare periphery interface after a package upgrade.
 */
library FtsoV2Compat {
    function officialSelector() internal pure returns (bytes4) {
        return FtsoV2Interface.getFeedByIdInWei.selector;
    }

    function minimalSelector() internal pure returns (bytes4) {
        return IFtsoV2Minimal.getFeedByIdInWei.selector;
    }
}
