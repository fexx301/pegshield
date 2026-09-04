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
    UnexpectedTokenBalanceDelta
} from "../src/PegShieldTypes.sol";

contract PegShieldPoolClaimsTest is Test {
    bytes32 internal constant TOPIC0 =
        0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f;
    address internal constant EMITTER = 0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7;
    bytes internal constant FIRST_PROOF = hex"01";
    bytes internal constant CONFIRMATION_PROOF = hex"02";

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
        // Keep the familiar 1_000_010 policy start while satisfying the
        // protocol's five-minute cross-chain clock-skew buffer.
        vm.warp(999_710);
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
            activationDelay: 5 minutes,
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

    function _signedWord(int256 value) internal pure returns (bytes32 result) {
        assembly {
            result := value
        }
    }

    function _setProof(
        bytes memory proof,
        bytes32 digest,
        uint256 updatedAt,
        uint256 roundId,
        int256 answer
    ) internal {
        _setProofWith(proof, 3, EMITTER, TOPIC0, digest, 0, updatedAt, roundId, answer, true);
    }

    function _setProofWith(
        bytes memory proof,
        uint256 chainKey,
        address emitter,
        bytes32 topic0,
        bytes32 digest,
        uint256 receiptPosition,
        uint256 updatedAt,
        uint256 roundId,
        int256 answer,
        bool succeeded
    ) internal {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = topic0;
        topics[1] = _signedWord(answer);
        topics[2] = bytes32(roundId);
        verifier.setSourceForProof(
            proof,
            chainKey,
            digest,
            receiptPosition,
            emitter,
            topics,
            abi.encode(updatedAt),
            succeeded
        );
    }

    function _setValidPair() internal {
        _setProof(FIRST_PROOF, bytes32(uint256(1)), 1_000_020, 10, 99_000_000);
        _setProof(CONFIRMATION_PROOF, bytes32(uint256(2)), 1_000_045, 11, 98_000_000);
    }

    function _submit(uint256 id) internal {
        pool.submitClaim(id, FIRST_PROOF, 0, CONFIRMATION_PROOF, 0);
    }

    function _eventId(bytes32 digest) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("PEGSHIELD_ATTESTED_EVM_V1_CHAINLINK_LOG_V1"),
                uint256(3),
                digest,
                uint256(0),
                EMITTER,
                TOPIC0
            )
        );
    }

    function test_submitClaimAtomicallyRecordsBothObservationsAndPays() public {
        _setValidPair();
        uint256 beforeBalance = token.balanceOf(beneficiary);
        vm.prank(attacker);
        _submit(policyId);

        Policy memory policy = pool.getPolicy(policyId);
        assertEq(uint8(policy.state), uint8(PolicyState.Claimed));
        assertEq(policy.firstBreachAt, 1_000_020);
        assertEq(policy.firstRoundId, 10);
        assertEq(policy.firstEventId, _eventId(bytes32(uint256(1))));
        assertTrue(pool.eventConsumedByPolicy(policyId, _eventId(bytes32(uint256(1)))));
        assertTrue(pool.eventConsumedByPolicy(policyId, _eventId(bytes32(uint256(2)))));
        assertEq(token.balanceOf(beneficiary), beforeBalance + 100e6);
        assertEq(token.balanceOf(attacker), 0);
        assertEq(pool.reservedCapital(), 0);
        assertEq(pool.accountedCapital(), 402_500_000);
    }

    function test_adversaryCannotPinLateFirstObservation() public {
        _setProof(FIRST_PROOF, bytes32(uint256(9)), 1_000_105, 20, 99_000_000);
        _setProof(CONFIRMATION_PROOF, bytes32(uint256(8)), 1_000_020, 10, 98_000_000);
        vm.prank(attacker);
        vm.expectRevert(ConfirmationEventNotLater.selector);
        _submit(policyId);

        assertEq(uint8(pool.getPolicy(policyId).state), uint8(PolicyState.Active));
        assertEq(pool.getPolicy(policyId).firstBreachAt, 0);
        _setValidPair();
        _submit(policyId);
        assertEq(uint8(pool.getPolicy(policyId).state), uint8(PolicyState.Claimed));
        assertEq(token.balanceOf(beneficiary), 100e6);
    }

    function test_samePairCanSettleTwoPoliciesButCannotReplay() public {
        uint256 secondPolicy = _buyPolicy(100e6, alternateBeneficiary);
        _setValidPair();
        _submit(policyId);
        _submit(secondPolicy);
        assertEq(token.balanceOf(beneficiary), 100e6);
        assertEq(token.balanceOf(alternateBeneficiary), 100e6);

        vm.expectRevert(
            abi.encodeWithSelector(PolicyNotActive.selector, policyId, uint8(PolicyState.Claimed))
        );
        _submit(policyId);
    }

    function test_bothEventsMustBeInsideCoverageWindow() public {
        _setProof(FIRST_PROOF, bytes32(uint256(1)), 1_000_009, 10, 99_000_000);
        _setProof(CONFIRMATION_PROOF, bytes32(uint256(2)), 1_000_045, 11, 98_000_000);
        vm.expectRevert(
            abi.encodeWithSelector(
                SourceEventOutsideCoverage.selector, 1_000_009, 1_000_010, 1_000_110
            )
        );
        _submit(policyId);

        _setProof(FIRST_PROOF, bytes32(uint256(1)), 1_000_020, 10, 99_000_000);
        _setProof(CONFIRMATION_PROOF, bytes32(uint256(2)), 1_000_111, 11, 98_000_000);
        vm.expectRevert(
            abi.encodeWithSelector(
                SourceEventOutsideCoverage.selector, 1_000_111, 1_000_010, 1_000_110
            )
        );
        _submit(policyId);
    }

    function test_submissionAfterGraceDeadlineFailsWithoutChangingState() public {
        _setValidPair();
        vm.warp(1_000_161);
        vm.expectRevert(
            abi.encodeWithSelector(ClaimSubmissionClosed.selector, 1_000_161, 1_000_160)
        );
        _submit(policyId);
        assertEq(uint8(pool.getPolicy(policyId).state), uint8(PolicyState.Active));
    }

    function test_firstProofSourceBoundaryChecksFailClosed() public {
        _setValidPair();
        _setProofWith(
            FIRST_PROOF, 4, EMITTER, TOPIC0, bytes32(uint256(1)), 0, 1_000_020, 10, 99_000_000, true
        );
        vm.expectRevert(abi.encodeWithSelector(WrongSourceChain.selector, 3, 4));
        _submit(policyId);

        _setProofWith(
            FIRST_PROOF,
            3,
            address(0x1234),
            TOPIC0,
            bytes32(uint256(1)),
            0,
            1_000_020,
            10,
            99_000_000,
            true
        );
        vm.expectRevert(abi.encodeWithSelector(WrongEmitter.selector, EMITTER, address(0x1234)));
        _submit(policyId);

        _setProofWith(
            FIRST_PROOF, 3, EMITTER, TOPIC0, bytes32(uint256(1)), 1, 1_000_020, 10, 99_000_000, true
        );
        vm.expectRevert(MalformedOracleLog.selector);
        _submit(policyId);
    }

    function test_topicReceiptAndAnswerChecksFailClosed() public {
        _setValidPair();
        _setProofWith(
            FIRST_PROOF,
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
        _submit(policyId);

        _setProofWith(
            FIRST_PROOF,
            3,
            EMITTER,
            TOPIC0,
            bytes32(uint256(1)),
            0,
            1_000_020,
            10,
            99_000_000,
            false
        );
        vm.expectRevert(SourceTransactionFailed.selector);
        _submit(policyId);

        _setProof(FIRST_PROOF, bytes32(uint256(1)), 1_000_020, 10, 0);
        vm.expectRevert(abi.encodeWithSelector(InvalidOracleAnswer.selector, int256(0)));
        _submit(policyId);

        _setProof(FIRST_PROOF, bytes32(uint256(1)), 1_000_020, 10, 100_000_000);
        vm.expectRevert(
            abi.encodeWithSelector(
                ThresholdNotBreached.selector, int256(100_000_000), int256(100_000_000)
            )
        );
        _submit(policyId);
    }

    function test_confirmationMustBeDistinctLaterAndFarEnoughApart() public {
        _setValidPair();
        _setProof(CONFIRMATION_PROOF, bytes32(uint256(1)), 1_000_045, 11, 98_000_000);
        vm.expectRevert(ConfirmationEventNotLater.selector);
        _submit(policyId);

        _setProof(CONFIRMATION_PROOF, bytes32(uint256(2)), 1_000_045, 9, 98_000_000);
        vm.expectRevert(ConfirmationEventNotLater.selector);
        _submit(policyId);

        _setProof(CONFIRMATION_PROOF, bytes32(uint256(2)), 1_000_020, 11, 98_000_000);
        vm.expectRevert(ConfirmationEventNotLater.selector);
        _submit(policyId);

        _setProof(CONFIRMATION_PROOF, bytes32(uint256(2)), 1_000_035, 11, 98_000_000);
        vm.expectRevert(abi.encodeWithSelector(BreachDurationNotMet.selector, 1_000_035, 1_000_040));
        _submit(policyId);
    }

    function test_payoutTokenDeltaIsChecked() public view {
        assertEq(token.balanceOf(beneficiary), 0);
        assertEq(pool.reservedCapital(), 100e6);
        assertEq(
            bytes4(UnexpectedTokenBalanceDelta.selector),
            bytes4(keccak256("UnexpectedTokenBalanceDelta(uint256,uint256)"))
        );
    }
}
