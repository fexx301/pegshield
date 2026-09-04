// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";
import { TestUSD } from "../src/TestUSD.sol";
import { PegShieldPool } from "../src/PegShieldPool.sol";
import { Product } from "../src/PegShieldTypes.sol";

/// @dev A bounded action surface lets Foundry exercise the accounting model
/// without granting the fuzzer arbitrary ERC20 or role-changing calls.
contract PegShieldPoolInvariantHandler {
    TestUSD internal immutable token;
    PegShieldPool internal immutable pool;
    uint256 internal immutable productId;
    address internal immutable beneficiary;

    constructor(TestUSD token_, PegShieldPool pool_, uint256 productId_, address beneficiary_) {
        token = token_;
        pool = pool_;
        productId = productId_;
        beneficiary = beneficiary_;
        token.approve(address(pool), type(uint256).max);
    }

    function fund(uint256 amount) external {
        amount = bound(amount, 1, 1_000e6);
        try pool.fundPool(amount) { } catch { }
    }

    function purchase(uint256 coverage) external {
        coverage = bound(coverage, 1, 25e6);
        try pool.buyPolicy(productId, coverage, beneficiary) { } catch { }
    }

    function withdraw(uint256 amount) external {
        amount = bound(amount, 1, 25e6);
        try pool.withdrawFreeCapital(amount, address(this)) { } catch { }
    }

    function expire(uint256 policyId) external {
        try pool.expirePolicy(policyId) { } catch { }
    }

    function invariantAccounting() external view {
        assert(pool.reservedCapital() <= pool.accountedCapital());
        assert(pool.accountedCapital() <= token.balanceOf(address(pool)));
    }

    function bound(uint256 value, uint256 min, uint256 max) private pure returns (uint256) {
        return min + (value % (max - min + 1));
    }
}

contract PegShieldPoolInvariantsTest is StdInvariant, Test {
    TestUSD internal token;
    PegShieldPool internal pool;
    PegShieldPoolInvariantHandler internal handler;
    address internal underwriter = address(0xA11CE);
    address internal beneficiary = address(0xCAFE);
    address internal adapter = address(0xADAB);

    function setUp() public {
        token = new TestUSD(address(this));
        pool = new PegShieldPool(token, adapter, address(this));
        Product memory product = Product({
            chainKey: 3,
            aggregator: address(0x1234),
            feedDecimals: 8,
            triggerBelow: 99_000_000,
            activationDelay: 5 minutes,
            policyDuration: 100,
            claimGracePeriod: 50,
            minBreachDuration: 1,
            premiumBps: 250,
            maxCoveragePerPolicy: 500e6,
            enabled: true
        });
        uint256 productId = pool.createProduct(product);
        handler = new PegShieldPoolInvariantHandler(token, pool, productId, beneficiary);
        token.mint(address(handler), 10_000e6);
        token.mint(address(this), 10_000e6);
        vm.prank(address(handler));
        pool.fundPool(1_000e6);
        targetContract(address(handler));
        vm.warp(10);
    }

    function invariant_reservedNeverExceedsAccounted() public view {
        assertLe(pool.reservedCapital(), pool.accountedCapital());
    }

    function invariant_accountedNeverExceedsTokenBalance() public view {
        assertLe(pool.accountedCapital(), token.balanceOf(address(pool)));
    }
}
