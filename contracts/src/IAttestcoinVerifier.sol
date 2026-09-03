// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IPegShieldVerifier } from "./interfaces/IPegShieldVerifier.sol";

/// @notice Named import surface for the production Attestcoin adapter.
/// @dev The official proof tuple is deliberately not declared here; keeping it
/// private to `AttestcoinVerifierAdapter` prevents business contracts from
/// depending on an external encoding that may evolve independently.
interface IAttestcoinVerifier is IPegShieldVerifier { }
