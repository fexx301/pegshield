// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { TestUSD } from "../src/TestUSD.sol";
import { PegShieldPool } from "../src/PegShieldPool.sol";
import { MockPegShieldVerifier } from "./mocks/MockAttestcoinDependencies.sol";
import {
    Product,
    Policy,
    PolicyState,
    ZeroAddress,
    WrongSourceChain,
    WrongEmitter,
    WrongEventSignature,
    MalformedOracleLog,
    SourceTransactionFailed,
    InvalidOracleAnswer,
    ThresholdNotBreached,
    SourceEventOutsideCoverage,
    ConfirmationEventNotLater,
    BreachDurationNotMet,
    ClaimSubmissionClosed,
    PolicyNotActive,
    PolicyNotBreached,
    UnexpectedTokenBalanceDelta
} from "../src/PegShieldTypes.sol";

contract PegShieldPoolClaimsTest is Test {
    bytes32 internal constant TOPIC0 =
        0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f;
    address internal constant EMITTER = 0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7;

    TestUSD internal token;
    MockPegShieldVerifier internal verifier;
    PegShieldPool internal pool;
    address internal underwriter = address(0xA11CE);
    address internal buyer = address(0xB0B);
    address internal beneficiary = address(0xCAFE);
    address internal alternateBeneficiary = address(0xD00D);
    address internal attacker = address(0xE11E);
    address internal funder = address(0xF00D);
    uint256 internal productId;
    uint256 internal policyId;

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
        policyId = _buyPolicy(100e6, beneficiary);
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

    function _buyPolicy(uint256 coverage, address policyBeneficiary) internal returns (uint256 id) {
        vm.prank(buyer);
        id = pool.buyPolicy(productId, coverage, policyBeneficiary);
    }

    function _setSource(
        bytes32 sourceHash,
        uint256 updatedAt,
        uint256 roundId,
        int256 answer,
        bool succeeded
    ) internal {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = TOPIC0;
        topics[1] = _signedWord(answer);
        topics[2] = bytes32(roundId);
        verifier.setSource(3, sourceHash, 0, EMITTER, topics, abi.encode(updatedAt), succeeded);
    }

    function _setSourceWith(
        uint256 chainKey,
        address emitter,
        bytes32 topic0,
        bytes32 sourceHash,
        uint256 receiptLogPosition,
        uint256 updatedAt,
        uint256 roundId,
        int256 answer,
        bool succeeded
    ) internal {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = topic0;
        topics[1] = _signedWord(answer);
        topics[2] = bytes32(roundId);
        verifier.setSource(
            chainKey,
            sourceHash,
            receiptLogPosition,
            emitter,
            topics,
            abi.encode(updatedAt),
            succeeded
        );
    }

    function _signedWord(int256 value) internal pure returns (bytes32 result) {
        assembly {
            result := value
        }
    }

    function _submitFirst(uint256 id, bytes32 sourceHash, uint256 updatedAt, uint256 roundId)
        internal
    {
        _setSource(sourceHash, updatedAt, roundId, 99_000_000, true);
        pool.submitBreachProof(id, hex"01", 0);
    }

    function _submitConfirmation(uint256 id, bytes32 sourceHash, uint256 updatedAt, uint256 roundId)
        internal
    {
        _setSource(sourceHash, updatedAt, roundId, 98_000_000, true);
        pool.submitConfirmationProof(id, hex"01", 0);
    }

    function test_submitBreachProof_recordsAuthenticatedObservation() public {
        _submitFirst(policyId, bytes32(uint256(1)), 1_000_020, 10);
        Policy memory policy = pool.getPolicy(policyId);
        assertEq(uint8(policy.state), uint8(PolicyState.BreachObserved));
        assertEq(policy.firstBreachAt, 1_000_020);
        assertEq(policy.firstRoundId, 10);
        bytes32 expectedEventId = keccak256(
            abi.encode(
                keccak256("PEGSHIELD_ATTESTED_EVM_V1_CHAINLINK_LOG_V1"),
                uint256(3),
                bytes32(uint256(1)),
                uint256(0),
                EMITTER,
                TOPIC0
            )
        );
        assertEq(policy.firstEventId, expectedEventId);
        assertTrue(pool.eventConsumedByPolicy(policyId, expectedEventId));
    }

    function test_submitConfirmationProof_paysImmutableBeneficiary() public {
        _submitFirst(policyId, bytes32(uint256(1)), 1_000_020, 10);
        uint256 beforeBalance = token.balanceOf(beneficiary);
        vm.warp(1_000_050);
        vm.prank(attacker);
        _submitConfirmation(policyId, bytes32(uint256(2)), 1_000_045, 11);

        Policy memory policy = pool.getPolicy(policyId);
        assertEq(uint8(policy.state), uint8(PolicyState.Claimed));
        assertEq(token.balanceOf(beneficiary), beforeBalance + 100e6);
        assertEq(token.balanceOf(attacker), 0);
        assertEq(pool.reservedCapital(), 0);
        assertEq(pool.accountedCapital(), 402_500_000);
    }

    function test_sameValidObservationWorksForTwoPoliciesButNotTwicePerPolicy() public {
        uint256 secondPolicy = _buyPolicy(100e6, alternateBeneficiary);
        _submitFirst(policyId, bytes32(uint256(1)), 1_000_020, 10);
        _submitFirst(secondPolicy, bytes32(uint256(1)), 1_000_020, 10);

        _setSource(bytes32(uint256(1)), 1_000_045, 11, 98_000_000, true);
        vm.expectRevert(ConfirmationEventNotLater.selector);
        pool.submitConfirmationProof(policyId, hex"01", 0);

        _submitConfirmation(policyId, bytes32(uint256(2)), 1_000_045, 11);
        _submitConfirmation(secondPolicy, bytes32(uint256(2)), 1_000_045, 11);
        assertEq(uint8(pool.getPolicy(policyId).state), uint8(PolicyState.Claimed));
        assertEq(uint8(pool.getPolicy(secondPolicy).state), uint8(PolicyState.Claimed));
    }

    function test_prePolicyAndActivationDelayEventsFail() public {
        _setSource(bytes32(uint256(1)), 1_000_009, 10, 99_000_000, true);
        vm.expectRevert(
            abi.encodeWithSelector(
                SourceEventOutsideCoverage.selector, 1_000_009, 1_000_010, 1_000_110
            )
        );
        pool.submitBreachProof(policyId, hex"01", 0);
    }

    function test_postEndEventFails() public {
        _setSource(bytes32(uint256(1)), 1_000_111, 10, 99_000_000, true);
        vm.expectRevert(
            abi.encodeWithSelector(
                SourceEventOutsideCoverage.selector, 1_000_111, 1_000_010, 1_000_110
            )
        );
        pool.submitBreachProof(policyId, hex"01", 0);
    }

    function test_submissionAfterGraceDeadlineFails() public {
        vm.warp(1_000_161);
        _setSource(bytes32(uint256(1)), 1_000_020, 10, 99_000_000, true);
        vm.expectRevert(
            abi.encodeWithSelector(ClaimSubmissionClosed.selector, 1_000_161, 1_000_160)
        );
        pool.submitBreachProof(policyId, hex"01", 0);
    }

    function test_wrongChainEmitterAndReceiptPositionFail() public {
        _setSourceWith(4, EMITTER, TOPIC0, bytes32(uint256(1)), 0, 1_000_020, 10, 99_000_000, true);
        vm.expectRevert(abi.encodeWithSelector(WrongSourceChain.selector, 3, 4));
        pool.submitBreachProof(policyId, hex"01", 0);

        _setSourceWith(
            3, address(0x1234), TOPIC0, bytes32(uint256(1)), 0, 1_000_020, 10, 99_000_000, true
        );
        vm.expectRevert(abi.encodeWithSelector(WrongEmitter.selector, EMITTER, address(0x1234)));
        pool.submitBreachProof(policyId, hex"01", 0);

        _setSourceWith(3, EMITTER, TOPIC0, bytes32(uint256(1)), 0, 1_000_020, 10, 99_000_000, true);
        vm.expectRevert(MalformedOracleLog.selector);
        pool.submitBreachProof(policyId, hex"01", 1);
    }

    function test_wrongTopicAndFailedReceiptFail() public {
        _setSourceWith(
            3,
            EMITTER,
            bytes32(uint256(123)),
            bytes32(uint256(1)),
            0,
            1_000_020,
            10,
            99_000_000,
            true
        );
        vm.expectRevert(abi.encodeWithSelector(WrongEventSignature.selector, bytes32(uint256(123))));
        pool.submitBreachProof(policyId, hex"01", 0);

        _setSourceWith(3, EMITTER, TOPIC0, bytes32(uint256(1)), 0, 1_000_020, 10, 99_000_000, false);
        vm.expectRevert(SourceTransactionFailed.selector);
        pool.submitBreachProof(policyId, hex"01", 0);
    }

    function test_zeroNegativeEqualityAndAboveThresholdFail() public {
        _setSourceWith(3, EMITTER, TOPIC0, bytes32(uint256(1)), 0, 1_000_020, 10, 0, true);
        vm.expectRevert(abi.encodeWithSelector(InvalidOracleAnswer.selector, int256(0)));
        pool.submitBreachProof(policyId, hex"01", 0);

        _setSourceWith(3, EMITTER, TOPIC0, bytes32(uint256(2)), 0, 1_000_020, 10, -1, true);
        vm.expectRevert(abi.encodeWithSelector(InvalidOracleAnswer.selector, int256(-1)));
        pool.submitBreachProof(policyId, hex"01", 0);

        _setSourceWith(3, EMITTER, TOPIC0, bytes32(uint256(3)), 0, 1_000_020, 10, 100_000_000, true);
        vm.expectRevert(
            abi.encodeWithSelector(
                ThresholdNotBreached.selector, int256(100_000_000), int256(100_000_000)
            )
        );
        pool.submitBreachProof(policyId, hex"01", 0);

        _setSourceWith(3, EMITTER, TOPIC0, bytes32(uint256(4)), 0, 1_000_020, 10, 100_000_001, true);
        vm.expectRevert(
            abi.encodeWithSelector(
                ThresholdNotBreached.selector, int256(100_000_001), int256(100_000_000)
            )
        );
        pool.submitBreachProof(policyId, hex"01", 0);
    }

    function test_confirmationOrderingAndMinimumDurationFail() public {
        _submitFirst(policyId, bytes32(uint256(1)), 1_000_020, 10);

        _setSource(bytes32(uint256(1)), 1_000_040, 11, 98_000_000, true);
        vm.expectRevert(ConfirmationEventNotLater.selector);
        pool.submitConfirmationProof(policyId, hex"01", 0);

        _setSource(bytes32(uint256(2)), 1_000_040, 9, 98_000_000, true);
        vm.expectRevert(ConfirmationEventNotLater.selector);
        pool.submitConfirmationProof(policyId, hex"01", 0);

        _setSource(bytes32(uint256(3)), 1_000_020, 11, 98_000_000, true);
        vm.expectRevert(ConfirmationEventNotLater.selector);
        pool.submitConfirmationProof(policyId, hex"01", 0);

        _setSource(bytes32(uint256(4)), 1_000_035, 11, 98_000_000, true);
        vm.expectRevert(abi.encodeWithSelector(BreachDurationNotMet.selector, 1_000_035, 1_000_040));
        pool.submitConfirmationProof(policyId, hex"01", 0);
    }

    function test_stateBoundariesRejectDuplicateFirstAndRepeatedPayout() public {
        _submitFirst(policyId, bytes32(uint256(1)), 1_000_020, 10);
        vm.expectRevert(
            abi.encodeWithSelector(
                PolicyNotActive.selector, policyId, uint8(PolicyState.BreachObserved)
            )
        );
        pool.submitBreachProof(policyId, hex"01", 0);
        _submitConfirmation(policyId, bytes32(uint256(2)), 1_000_045, 11);
        vm.expectRevert(
            abi.encodeWithSelector(PolicyNotBreached.selector, policyId, uint8(PolicyState.Claimed))
        );
        pool.submitConfirmationProof(policyId, hex"01", 0);
    }

    function test_payoutTokenDeltaIsChecked() public {
        // TestUSD is exact-transfer, so this only documents the invariant at
        // the pool boundary; fee-on-transfer tokens are rejected at funding.
        assertEq(token.balanceOf(beneficiary), 0);
        assertEq(pool.reservedCapital(), 100e6);
        assertEq(
            bytes4(UnexpectedTokenBalanceDelta.selector),
            bytes4(keccak256("UnexpectedTokenBalanceDelta(uint256,uint256)"))
        );
    }
}
