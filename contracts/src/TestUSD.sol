// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ZeroAddress } from "./PegShieldTypes.sol";

/// @title TestUSD
/// @notice Six-decimal demo payout token for the CC3 testnet demonstration.
/// @dev This faucet-like minter is intentionally testnet-only and is not a
/// production stablecoin. A deployment script should grant MINTER_ROLE only
/// to the explicitly authorized demo operator.
contract TestUSD is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    constructor(address admin) ERC20("PegShield Test USD", "tUSD") {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    /// @notice Mints demo tokens for testnet setup and scripted scenarios.
    /// @dev Never use this unrestricted demo minter as a mainnet asset.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
