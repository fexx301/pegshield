// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { TestUSD } from "../src/TestUSD.sol";
import { PegShieldPool } from "../src/PegShieldPool.sol";
import { FeeOnTransferToken } from "./mocks/FeeOnTransferToken.sol";
import {
    Product,
    ZeroAddress,
    ZeroAmount,
    UnknownProduct,
    ProductAlreadyDisabled,
    InvalidProductConfig,
    InsufficientFreeCapital,
    UnexpectedTokenBalanceDelta,
    UnknownPolicy
} from "../src/PegShieldTypes.sol";

contract PegShieldPoolAccountingTest is Test {
    TestUSD private token;
    PegShieldPool private pool;
    address private underwriter = address(0xA11CE);
    address private funder = address(0xB0B);
    address private outsider = address(0xCAFE);
    address private adapter = address(0xADAB);

    function setUp() public {
        token = new TestUSD(underwriter);
        pool = new PegShieldPool(token, adapter, underwriter);
        vm.prank(underwriter);
        token.mint(funder, 1_000e6);
        vm.prank(funder);
        token.approve(address(pool), type(uint256).max);
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

    function test_constructorPinsTokenAdapterAndRole() public view {
        assertEq(address(pool.payoutToken()), address(token));
        assertEq(pool.verifierAdapter(), adapter);
        assertTrue(pool.hasRole(pool.DEFAULT_ADMIN_ROLE(), underwriter));
        assertTrue(pool.hasRole(pool.UNDERWRITER_ROLE(), underwriter));
        assertFalse(pool.hasRole(pool.UNDERWRITER_ROLE(), address(this)));
    }

    function test_constructorRejectsZeroAddresses() public {
        vm.expectRevert(ZeroAddress.selector);
        new PegShieldPool(token, address(0), underwriter);
        vm.expectRevert(ZeroAddress.selector);
        new PegShieldPool(token, adapter, address(0));
        vm.expectRevert(ZeroAddress.selector);
        new PegShieldPool(TestUSD(address(0)), adapter, underwriter);
    }

    function test_fundPoolAccountsExactAmountAndSupportsThirdParty() public {
        vm.prank(funder);
        pool.fundPool(100e6);
        assertEq(pool.accountedCapital(), 100e6);
        assertEq(pool.reservedCapital(), 0);
        assertEq(pool.availableCapital(), 100e6);
        assertEq(token.balanceOf(address(pool)), 100e6);
    }

    function test_fundPoolRejectsZero() public {
        vm.expectRevert(ZeroAmount.selector);
        pool.fundPool(0);
    }

    function test_fundPoolRejectsFeeOnTransferToken() public {
        FeeOnTransferToken feeToken = new FeeOnTransferToken();
        PegShieldPool feePool = new PegShieldPool(feeToken, adapter, underwriter);
        feeToken.mint(funder, 100e6);
        vm.startPrank(funder);
        feeToken.approve(address(feePool), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(UnexpectedTokenBalanceDelta.selector, 100e6, 99e6));
        feePool.fundPool(100e6);
        vm.stopPrank();
        assertEq(feePool.accountedCapital(), 0);
    }

    function test_withdrawFreeCapitalOnlyUsesAvailable() public {
        vm.prank(funder);
        pool.fundPool(100e6);
        vm.prank(underwriter);
        pool.withdrawFreeCapital(40e6, outsider);
        assertEq(pool.accountedCapital(), 60e6);
        assertEq(pool.availableCapital(), 60e6);
        assertEq(token.balanceOf(outsider), 40e6);
    }

    function test_withdrawRejectsZeroRecipientAmountAndExcess() public {
        vm.prank(funder);
        pool.fundPool(100e6);
        vm.startPrank(underwriter);
        vm.expectRevert(ZeroAmount.selector);
        pool.withdrawFreeCapital(0, outsider);
        vm.expectRevert(ZeroAddress.selector);
        pool.withdrawFreeCapital(1, address(0));
        vm.expectRevert(abi.encodeWithSelector(InsufficientFreeCapital.selector, 101e6, 100e6));
        pool.withdrawFreeCapital(101e6, outsider);
        vm.stopPrank();
    }

    function test_withdrawRequiresUnderwriter() public {
        vm.prank(funder);
        pool.fundPool(100e6);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                outsider,
                pool.UNDERWRITER_ROLE()
            )
        );
        vm.prank(outsider);
        pool.withdrawFreeCapital(1, outsider);
    }

    function test_withdrawRejectsUnexpectedRecipientDelta() public {
        FeeOnTransferToken feeToken = new FeeOnTransferToken();
        PegShieldPool feePool = new PegShieldPool(feeToken, adapter, underwriter);
        feeToken.mint(funder, 100e6);
        feeToken.setFeeEnabled(false);
        vm.startPrank(funder);
        feeToken.approve(address(feePool), type(uint256).max);
        feePool.fundPool(100e6);
        vm.stopPrank();
        feeToken.setFeeEnabled(true);

        vm.expectRevert(abi.encodeWithSelector(UnexpectedTokenBalanceDelta.selector, 100e6, 99e6));
        vm.prank(underwriter);
        feePool.withdrawFreeCapital(100e6, outsider);
        assertEq(feePool.accountedCapital(), 100e6);
    }

    function test_createProductStoresSequentialImmutableTerms() public {
        Product memory product = _validProduct();
        vm.prank(underwriter);
        uint256 first = pool.createProduct(product);
        vm.prank(underwriter);
        uint256 second = pool.createProduct(product);
        assertEq(first, 1);
        assertEq(second, 2);
        Product memory stored = pool.getProduct(first);
        assertEq(stored.chainKey, product.chainKey);
        assertEq(stored.aggregator, product.aggregator);
        assertEq(stored.triggerBelow, product.triggerBelow);
        assertEq(stored.maxCoveragePerPolicy, product.maxCoveragePerPolicy);
        assertTrue(stored.enabled);
        assertEq(pool.nextProductId(), 3);
    }

    function test_createProductRequiresUnderwriterAndEveryBoundary() public {
        Product memory product = _validProduct();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                outsider,
                pool.UNDERWRITER_ROLE()
            )
        );
        vm.prank(outsider);
        pool.createProduct(product);

        product.chainKey = 0;
        _expectInvalidProduct(product);
        product = _validProduct();
        product.chainKey = 1;
        _expectInvalidProduct(product);
        product = _validProduct();
        product.aggregator = address(0);
        _expectInvalidProduct(product);
        product = _validProduct();
        product.feedDecimals = 18;
        _expectInvalidProduct(product);
        product = _validProduct();
        product.triggerBelow = 0;
        _expectInvalidProduct(product);
        product = _validProduct();
        product.policyDuration = 0;
        _expectInvalidProduct(product);
        product = _validProduct();
        product.activationDelay = 0;
        _expectInvalidProduct(product);
        product = _validProduct();
        product.claimGracePeriod = 0;
        _expectInvalidProduct(product);
        product = _validProduct();
        product.minBreachDuration = 0;
        _expectInvalidProduct(product);
        product = _validProduct();
        product.minBreachDuration = product.policyDuration;
        _expectInvalidProduct(product);
        product = _validProduct();
        product.premiumBps = 0;
        _expectInvalidProduct(product);
        product = _validProduct();
        product.premiumBps = 10_001;
        _expectInvalidProduct(product);
        product = _validProduct();
        product.maxCoveragePerPolicy = 0;
        _expectInvalidProduct(product);
        product = _validProduct();
        product.enabled = false;
        _expectInvalidProduct(product);
    }

    function _expectInvalidProduct(Product memory product) internal {
        vm.expectRevert(InvalidProductConfig.selector);
        vm.prank(underwriter);
        pool.createProduct(product);
    }

    function test_disableProductIsOneWayAndUnknownReadsRevert() public {
        vm.prank(underwriter);
        uint256 productId = pool.createProduct(_validProduct());
        vm.prank(underwriter);
        pool.disableProduct(productId);
        assertFalse(pool.getProduct(productId).enabled);
        vm.expectRevert(abi.encodeWithSelector(ProductAlreadyDisabled.selector, productId));
        vm.prank(underwriter);
        pool.disableProduct(productId);
        vm.expectRevert(abi.encodeWithSelector(UnknownProduct.selector, 99));
        pool.getProduct(99);
        vm.expectRevert(abi.encodeWithSelector(UnknownPolicy.selector, 99));
        pool.getPolicy(99);
    }

    function test_directDonationDoesNotIncreaseAccounting() public {
        vm.prank(underwriter);
        token.mint(outsider, 25e6);
        vm.prank(outsider);
        token.transfer(address(pool), 25e6);
        assertEq(token.balanceOf(address(pool)), 25e6);
        assertEq(pool.accountedCapital(), 0);
        assertEq(pool.availableCapital(), 0);
    }
}
