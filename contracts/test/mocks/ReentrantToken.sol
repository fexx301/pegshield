// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only token that attempts a callback while the pool pays out.
/// The callback result is recorded and deliberately swallowed so the transfer
/// can finish; a ReentrancyGuard-protected pool must report `false`.
contract ReentrantToken is ERC20 {
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackEnabled;
    bool public callbackAttempted;
    bool public callbackSucceeded;

    constructor() ERC20("Reentrant Token", "REENT") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function configureCallback(address target, bytes calldata data, bool enabled) external {
        callbackTarget = target;
        callbackData = data;
        callbackEnabled = enabled;
        callbackAttempted = false;
        callbackSucceeded = false;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (callbackEnabled && msg.sender == callbackTarget) {
            callbackAttempted = true;
            (callbackSucceeded,) = callbackTarget.call(callbackData);
        }
        return super.transfer(to, amount);
    }
}
