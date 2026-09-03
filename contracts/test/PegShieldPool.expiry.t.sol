// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { TestUSD } from "../src/TestUSD.sol";
import { PegShieldPool } from "../src/PegShieldPool.sol";
import { MockPegShieldVerifier } from "./mocks/MockAttestcoinDependencies.sol";
import {
    Product,
    PolicyState,
    PolicyNotExpirable,
    ExpiryTooEarly
} from "../src/PegShieldTypes.sol";

/// @notice P09 boundary coverage for reserve release and terminal states.
contract PegShieldPoolExpiryTest is Test {
    bytes32 internal constant TOPIC0 =
        0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f;
    address internal constant EMITTER = 0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7;

    TestUSD internal token;
    MockPegShieldVerifier internal verifier;
    PegShieldPool internal pool;
    address internal underwriter = address(0xA11CE);
    address internal buyer = address(0xB0B);
    address internal beneficiary = address(0xCAFE);
    address internal funder = address(0xF00D);
    uint256 internal productId;

    function setUp() public {
        token = new TestUSD(underwriter);
        verifier = new MockPegShieldVerifier();
        pool = new PegShieldPool(token, address(verifier), underwriter);
        vm.prank(underwriter);
        token.mint(buyer, 1_000e6);
        vm.prank(underwriter);
        token.mint(funder, 1_000e6);
        vm.prank(buyer);
        token.approve(address(pool), type(uint256).max);
        vm.prank(funder);
        token.approve(address(pool), type(uint256).max);
        vm.warp(1_000_000);
        vm.prank(underwriter);
        productId = pool.createProduct(_validProduct());
        vm.prank(funder);
        pool.fundPool(500e6);
    }

    function _validProduct() internal pure returns (Product memory) {
        return Product({
            chainKey: 3,
            aggregator: EMITTER,
            feedDecimals: 8,
            triggerBelow: 100_000_000,
            activationDelay: 10,
            policyDuration: 100,
            claimGracePeriod: 50,
            minBreachDuration: 20,
            premiumBps: 250,
            maxCoveragePerPolicy: 500e6,
            enabled: true
        });
    }

    function _buy() internal returns (uint256 policyId) {
        vm.prank(buyer);
        policyId = pool.buyPolicy(productId, 100e6, beneficiary);
    }

    function _setBreach(bytes32 digest, uint256 updatedAt, uint256 roundId) internal {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = TOPIC0;
        topics[1] = bytes32(uint256(99_000_000));
        topics[2] = bytes32(roundId);
        verifier.setSource(3, digest, 0, EMITTER, topics, abi.encode(updatedAt), true);
    }

    function test_expireActiveReleasesReserveButNotAccountedCapital() public {
        uint256 policyId = _buy();
        uint256 accounted = pool.accountedCapital();
        vm.warp(1_000_160);
        vm.expectRevert(abi.encodeWithSelector(ExpiryTooEarly.selector, 1_000_160, 1_000_160));
        pool.expirePolicy(policyId);

        vm.warp(1_000_161);
        pool.expirePolicy(policyId);
        assertEq(uint8(pool.getPolicy(policyId).state), uint8(PolicyState.Expired));
        assertEq(pool.reservedCapital(), 0);
        assertEq(pool.accountedCapital(), accounted);
    }

    function test_expireBreachObservedReleasesReserve() public {
        uint256 policyId = _buy();
        _setBreach(bytes32(uint256(1)), 1_000_020, 10);
        pool.submitBreachProof(policyId, hex"01", 0);
        vm.warp(1_000_161);
        pool.expirePolicy(policyId);
        assertEq(uint8(pool.getPolicy(policyId).state), uint8(PolicyState.Expired));
        assertEq(pool.reservedCapital(), 0);
    }

    function test_expiryIsOneWayAndTerminalPoliciesCannotExpire() public {
        uint256 expiredPolicy = _buy();
        vm.warp(1_000_161);
        pool.expirePolicy(expiredPolicy);
        vm.expectRevert(
            abi.encodeWithSelector(
                PolicyNotExpirable.selector, expiredPolicy, uint8(PolicyState.Expired)
            )
        );
        pool.expirePolicy(expiredPolicy);

        vm.warp(1_000_000);
        uint256 claimedPolicy = _buy();
        _setBreach(bytes32(uint256(2)), 1_000_020, 10);
        pool.submitBreachProof(claimedPolicy, hex"01", 0);
        vm.warp(1_000_050);
        _setBreach(bytes32(uint256(3)), 1_000_045, 11);
        pool.submitConfirmationProof(claimedPolicy, hex"01", 0);
        vm.warp(1_000_161);
        vm.expectRevert(
            abi.encodeWithSelector(
                PolicyNotExpirable.selector, claimedPolicy, uint8(PolicyState.Claimed)
            )
        );
        pool.expirePolicy(claimedPolicy);
    }
}
