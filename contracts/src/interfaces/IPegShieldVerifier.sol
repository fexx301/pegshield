// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { VerifiedSourceLog } from "../PegShieldTypes.sol";

/// @notice Stable boundary between PegShieldPool and the Attestcoin adapter.
/// @dev The proof itself stays opaque to the pool and is ABI-decoded only by
/// the adapter implementation.
interface IPegShieldVerifier {
    function verifySourceLog(bytes calldata encodedProof, uint256 receiptLogPosition)
        external
        view
        returns (VerifiedSourceLog memory);
}
