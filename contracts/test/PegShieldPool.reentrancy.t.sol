// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { PegShieldPool } from "../src/PegShieldPool.sol";
import { Product, PolicyState } from "../src/PegShieldTypes.sol";
import { MockPegShieldVerifier } from "./mocks/MockAttestcoinDependencies.sol";
import { ReentrantToken } from "./mocks/ReentrantToken.sol";

/// @notice Demonstrates that an ERC20 callback cannot re-enter a payout.
contract PegShieldPoolReentrancyTest is Test {
    bytes32 internal constant TOPIC0 =
        0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f;
    address internal constant EMITTER = 0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7;

    ReentrantToken internal token;
    MockPegShieldVerifier internal verifier;
    PegShieldPool internal pool;
    address internal underwriter = address(0xA11CE);
    address internal buyer = address(0xB0B);
    address internal funder = address(0xF00D);
    address internal beneficiary = address(0xCAFE);
    address internal relayer = address(0xBEEF);
    uint256 internal productId;

    function setUp() public {
        token = new ReentrantToken();
        verifier = new MockPegShieldVerifier();
        pool = new PegShieldPool(token, address(verifier), underwriter);
        token.mint(buyer, 1_000e6);
        token.mint(funder, 1_000e6);
        vm.prank(buyer);
        token.approve(address(pool), type(uint256).max);
        vm.prank(funder);
        token.approve(address(pool), type(uint256).max);
        vm.warp(999_710);
        vm.prank(underwriter);
        productId = pool.createProduct(_validProduct());
        vm.prank(funder);
        pool.fundPool(500e6);
        vm.prank(buyer);
        pool.buyPolicy(productId, 100e6, beneficiary);
    }

    function _validProduct() internal pure returns (Product memory) {
        return Product({
            chainKey: 3,
            aggregator: EMITTER,
            feedDecimals: 8,
            triggerBelow: 100_000_000,
            activationDelay: 5 minutes,
            policyDuration: 100,
            claimGracePeriod: 50,
            minBreachDuration: 20,
            premiumBps: 250,
            maxCoveragePerPolicy: 500e6,
            enabled: true
        });
    }

    function _setSource(bytes memory proof, bytes32 digest, uint256 updatedAt, uint256 roundId)
        internal
    {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = TOPIC0;
        topics[1] = bytes32(uint256(99_000_000));
        topics[2] = bytes32(roundId);
        verifier.setSourceForProof(
            proof, 3, digest, 0, EMITTER, topics, abi.encode(updatedAt), true
        );
    }

    function test_payoutBlocksTokenCallbackAndPaysOnce() public {
        _setSource(hex"01", bytes32(uint256(1)), 1_000_020, 10);
        vm.warp(1_000_050);
        _setSource(hex"02", bytes32(uint256(2)), 1_000_045, 11);

        token.configureCallback(
            address(pool),
            abi.encodeCall(
                PegShieldPool.submitClaim, (1, hex"01", uint256(0), hex"02", uint256(0))
            ),
            true
        );
        vm.prank(relayer);
        pool.submitClaim(1, hex"01", 0, hex"02", 0);

        assertTrue(token.callbackAttempted());
        assertFalse(token.callbackSucceeded());
        assertEq(token.balanceOf(beneficiary), 100e6);
        assertEq(pool.reservedCapital(), 0);
        assertEq(uint8(pool.getPolicy(1).state), uint8(PolicyState.Claimed));
    }
}
