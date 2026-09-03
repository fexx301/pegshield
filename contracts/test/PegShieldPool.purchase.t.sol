// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { TestUSD } from "../src/TestUSD.sol";
import { PegShieldPool } from "../src/PegShieldPool.sol";
import { FeeOnTransferToken } from "./mocks/FeeOnTransferToken.sol";
import {
    Policy,
    Product,
    ZeroAddress,
    ZeroAmount,
    UnknownProduct,
    ProductDisabled,
    CoverageAboveProductMaximum,
    InsufficientFreeCapital,
    UnexpectedTokenBalanceDelta
} from "../src/PegShieldTypes.sol";

contract PegShieldPoolPurchaseTest is Test {
    TestUSD private token;
    PegShieldPool private pool;
    address private underwriter = address(0xA11CE);
    address private buyer = address(0xB0B);
    address private funder = address(0xD00D);
    address private beneficiary = address(0xCAFE);
    address private adapter = address(0xADAB);
    uint256 private productId;

    function setUp() public {
        token = new TestUSD(underwriter);
        pool = new PegShieldPool(token, adapter, underwriter);
        vm.prank(underwriter);
        token.mint(buyer, 1_000e6);
        vm.prank(underwriter);
        token.mint(funder, 1_000e6);
        vm.prank(buyer);
        token.approve(address(pool), type(uint256).max);
        vm.prank(funder);
        token.approve(address(pool), type(uint256).max);
        vm.prank(underwriter);
        productId = pool.createProduct(_validProduct());
    }

    function _validProduct() internal pure returns (Product memory) {
        return Product({
            chainKey: 3,
            aggregator: address(0x1234),
            feedDecimals: 8,
            triggerBelow: 99_000_000,
            activationDelay: 1 hours,
            policyDuration: 7 days,
            claimGracePeriod: 2 days,
            minBreachDuration: 1 hours,
            premiumBps: 250,
            maxCoveragePerPolicy: 500e6,
            enabled: true
        });
    }

    function test_quotePremium_roundsUp() public view {
        assertEq(pool.quotePremium(productId, 0), 0);
        assertEq(pool.quotePremium(productId, 1), 1);
        assertEq(pool.quotePremium(productId, 40), 1);
        assertEq(pool.quotePremium(productId, 41), 2);
        assertEq(pool.quotePremium(productId, 100e6), 2_500_000);
    }

    function test_buyPolicy_collectsPremiumAndReservesCoverage() public {
        _fund(100e6);
        vm.prank(buyer);
        uint256 policyId = pool.buyPolicy(productId, 100e6, beneficiary);

        assertEq(policyId, 1);
        assertEq(pool.nextPolicyId(), 2);
        assertEq(pool.accountedCapital(), 102_500_000);
        assertEq(pool.reservedCapital(), 100e6);
        assertEq(pool.availableCapital(), 2_500_000);
        assertEq(token.balanceOf(address(pool)), 102_500_000);

        Policy memory policy = pool.getPolicy(policyId);
        assertEq(policy.productId, productId);
        assertEq(policy.holder, buyer);
        assertEq(policy.beneficiary, beneficiary);
        assertEq(policy.coverage, 100e6);
        assertEq(policy.premium, 2_500_000);
        assertEq(policy.purchasedAt, block.timestamp);
        assertEq(policy.startsAt, block.timestamp + 1 hours);
        assertEq(policy.endsAt, block.timestamp + 1 hours + 7 days);
        assertEq(uint8(policy.state), 0);
    }

    function test_buyPolicy_allowsDifferentBeneficiary() public {
        _fund(50e6);
        vm.prank(buyer);
        uint256 policyId = pool.buyPolicy(productId, 50e6, beneficiary);
        assertEq(pool.getPolicy(policyId).beneficiary, beneficiary);
        assertEq(pool.getPolicy(policyId).holder, buyer);
    }

    function test_buyPolicy_countsPremiumAsBackingAtomically() public {
        _fund(100e6);
        vm.prank(buyer);
        pool.buyPolicy(productId, 100e6, beneficiary);

        // Only the premium remains available, but that premium is itself
        // backing and can fund a second, smaller reserve.
        vm.prank(buyer);
        pool.buyPolicy(productId, 2_500_000, beneficiary);
        assertEq(pool.accountedCapital(), 102_562_500);
        assertEq(pool.reservedCapital(), 102_500_000);
        assertEq(pool.availableCapital(), 62_500);
    }

    function test_buyPolicy_revertsForUnknownOrDisabledProduct() public {
        vm.expectRevert(abi.encodeWithSelector(UnknownProduct.selector, 99));
        vm.prank(buyer);
        pool.buyPolicy(99, 1, beneficiary);

        vm.prank(underwriter);
        pool.disableProduct(productId);
        vm.expectRevert(abi.encodeWithSelector(ProductDisabled.selector, productId));
        vm.prank(buyer);
        pool.buyPolicy(productId, 1, beneficiary);
    }

    function test_buyPolicy_revertsForZeroCoverageOrBeneficiary() public {
        vm.expectRevert(ZeroAmount.selector);
        vm.prank(buyer);
        pool.buyPolicy(productId, 0, beneficiary);
        vm.expectRevert(ZeroAddress.selector);
        vm.prank(buyer);
        pool.buyPolicy(productId, 1, address(0));
    }

    function test_buyPolicy_revertsAboveProductMaximum() public {
        vm.expectRevert(
            abi.encodeWithSelector(CoverageAboveProductMaximum.selector, 500e6 + 1, 500e6)
        );
        vm.prank(buyer);
        pool.buyPolicy(productId, 500e6 + 1, beneficiary);
    }

    function test_buyPolicy_revertsWhenPostPremiumCapitalInsufficient() public {
        uint256 coverage = 100e6;
        uint256 premium = pool.quotePremium(productId, coverage);
        vm.expectRevert(abi.encodeWithSelector(InsufficientFreeCapital.selector, coverage, premium));
        vm.prank(buyer);
        pool.buyPolicy(productId, coverage, beneficiary);

        _fund(100e6);
        coverage = 103e6;
        premium = pool.quotePremium(productId, coverage);
        vm.expectRevert(
            abi.encodeWithSelector(InsufficientFreeCapital.selector, coverage, 100e6 + premium)
        );
        vm.prank(buyer);
        pool.buyPolicy(productId, coverage, beneficiary);
    }

    function test_buyPolicy_revertsForFeeOnTransferToken() public {
        FeeOnTransferToken feeToken = new FeeOnTransferToken();
        PegShieldPool feePool = new PegShieldPool(feeToken, adapter, underwriter);
        feeToken.mint(buyer, 100e6);
        feeToken.mint(funder, 100e6);
        vm.prank(underwriter);
        uint256 feeProductId = feePool.createProduct(_validProduct());
        feeToken.setFeeEnabled(false);
        vm.startPrank(funder);
        feeToken.approve(address(feePool), type(uint256).max);
        feePool.fundPool(100e6);
        vm.stopPrank();
        feeToken.setFeeEnabled(true);
        vm.startPrank(buyer);
        feeToken.approve(address(feePool), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(UnexpectedTokenBalanceDelta.selector, 2_500_000, 2_475_000)
        );
        feePool.buyPolicy(feeProductId, 100e6, beneficiary);
        vm.stopPrank();
        assertEq(feePool.accountedCapital(), 100e6);
        assertEq(feePool.reservedCapital(), 0);
    }

    function testFuzz_purchasePreservesAccountingInvariant(uint256 coverage) public {
        coverage = bound(coverage, 1, 100e6);
        _fund(100e6);
        vm.prank(buyer);
        pool.buyPolicy(productId, coverage, beneficiary);
        assertLe(pool.reservedCapital(), pool.accountedCapital());
        assertEq(pool.availableCapital(), pool.accountedCapital() - pool.reservedCapital());
    }

    function _fund(uint256 amount) internal {
        vm.prank(funder);
        pool.fundPool(amount);
    }
}
