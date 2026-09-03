// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { AttestcoinVerifierAdapter } from "../src/AttestcoinVerifierAdapter.sol";
import {
    ContinuityProof,
    IEvmV1Decoder,
    MerkleProof,
    MerkleProofEntry,
    DecoderRejectedTransaction,
    InvalidProofEncoding,
    ProofVerificationFailed,
    ReceiptLogOutOfBounds,
    UnsupportedTransactionType
} from "../src/AttestcoinVerifierAdapter.sol";
import { ChainlinkAnswerUpdated } from "../src/ChainlinkAnswerUpdated.sol";
import {
    OracleObservation,
    VerifiedSourceLog,
    WrongEventSignature,
    MalformedOracleLog,
    WrongSourceChain
} from "../src/PegShieldTypes.sol";
import {
    MockAttestcoinBlockProver,
    MockEvmV1Decoder
} from "./mocks/MockAttestcoinDependencies.sol";

contract AttestcoinVerifierAdapterTest is Test {
    bytes32 internal constant TOPIC0 =
        0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f;
    address internal constant EMITTER = 0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7;
    address internal constant BLOCK_PROVER = address(0xBEEF);
    address internal constant DECODER = address(0xD00D);

    MockAttestcoinBlockProver internal prover;
    MockEvmV1Decoder internal decoder;
    AttestcoinVerifierAdapter internal adapter;
    bytes internal txBytes;

    function setUp() public {
        prover = new MockAttestcoinBlockProver();
        decoder = new MockEvmV1Decoder();
        adapter = new AttestcoinVerifierAdapter(address(prover), address(decoder));

        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(uint256(1));
        chunks[1] = abi.encode(uint256(2));
        chunks[2] = abi.encode(uint256(3));
        txBytes = abi.encode(uint8(2), chunks);

        bytes32[] memory topics = new bytes32[](3);
        topics[0] = TOPIC0;
        topics[1] = bytes32(uint256(99_989_777));
        topics[2] = bytes32(uint256(1_166));
        decoder.setReceipt(1, EMITTER, topics, abi.encode(uint256(1_788_249_611)));
        decoder.setExpectedEncodedTransaction(keccak256(txBytes));
        prover.setExpectedFingerprint(
            prover.fingerprint(3, 25_881_095, txBytes, _merkle(), _continuity())
        );
    }

    function _merkle() internal pure returns (MerkleProof memory proof) {
        MerkleProofEntry[] memory siblings = new MerkleProofEntry[](2);
        siblings[0] = MerkleProofEntry({ hash: bytes32(uint256(1)), isLeft: true });
        siblings[1] = MerkleProofEntry({ hash: bytes32(uint256(2)), isLeft: false });
        proof = MerkleProof({ root: bytes32(uint256(3)), siblings: siblings });
    }

    function _continuity() internal pure returns (ContinuityProof memory proof) {
        bytes32[] memory roots = new bytes32[](2);
        roots[0] = bytes32(uint256(4));
        roots[1] = bytes32(uint256(5));
        proof = ContinuityProof({ lowerEndpointDigest: bytes32(uint256(6)), roots: roots });
    }

    function _encodedProof() internal view returns (bytes memory) {
        return abi.encode(uint64(3), uint64(25_881_095), txBytes, _merkle(), _continuity());
    }

    function test_constructorPinsDependenciesAndRejectsZero() public {
        assertEq(adapter.blockProver(), address(prover));
        assertEq(adapter.decoder(), address(decoder));
        vm.expectRevert();
        new AttestcoinVerifierAdapter(address(0), address(decoder));
        vm.expectRevert();
        new AttestcoinVerifierAdapter(address(prover), address(0));
    }

    function test_fixtureThroughAdapterReturnsAuthenticatedReceiptLog() public {
        VerifiedSourceLog memory source = adapter.verifySourceLog(_encodedProof(), 0);
        assertEq(source.chainKey, 3);
        assertEq(source.attestedTransactionDigest, keccak256(txBytes));
        assertEq(source.receiptLogPosition, 0);
        assertEq(source.emitter, EMITTER);
        assertEq(source.topics.length, 3);
        assertEq(source.topics[0], TOPIC0);
        assertEq(source.topics[1], bytes32(uint256(99_989_777)));
        assertEq(source.topics[2], bytes32(uint256(1_166)));
        assertEq(abi.decode(source.data, (uint256)), 1_788_249_611);
        assertTrue(source.receiptSucceeded);
    }

    function test_wrongReceiptPositionFails() public {
        vm.expectRevert(abi.encodeWithSelector(ReceiptLogOutOfBounds.selector, 1, 1));
        adapter.verifySourceLog(_encodedProof(), 1);
    }

    function test_adapterPassesFullEncodedTransactionForEverySupportedType() public {
        for (uint8 txType; txType <= 4; ++txType) {
            uint256 chunkCount = txType <= 2 ? 3 : 4;
            bytes[] memory chunks = new bytes[](chunkCount);
            for (uint256 i; i < chunkCount; ++i) {
                chunks[i] = abi.encode(txType, i + 1);
            }
            bytes memory candidate = abi.encode(txType, chunks);
            decoder.setTransactionType(txType, true);
            decoder.setExpectedEncodedTransaction(keccak256(candidate));
            prover.setExpectedFingerprint(
                prover.fingerprint(3, 25_881_095, candidate, _merkle(), _continuity())
            );
            bytes memory proof =
                abi.encode(uint64(3), uint64(25_881_095), candidate, _merkle(), _continuity());
            VerifiedSourceLog memory source = adapter.verifySourceLog(proof, 0);
            assertEq(source.receiptLogPosition, 0);
        }
    }

    function test_adapterRejectsWrongEncodedTransactionSelection() public {
        decoder.setExpectedEncodedTransaction(keccak256(abi.encode(uint8(2), new bytes[](0))));
        vm.expectRevert();
        adapter.verifySourceLog(_encodedProof(), 0);
    }

    function test_failedReceiptStatusIsReturnedAsFalseForPoolGate() public {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = TOPIC0;
        topics[1] = bytes32(uint256(99_989_777));
        topics[2] = bytes32(uint256(1_166));
        decoder.setReceipt(0, EMITTER, topics, abi.encode(uint256(1_788_249_611)));
        VerifiedSourceLog memory source = adapter.verifySourceLog(_encodedProof(), 0);
        assertFalse(source.receiptSucceeded);
    }

    function test_oneByteTransactionMutationFails() public {
        bytes memory mutatedTx = txBytes;
        mutatedTx[mutatedTx.length - 1] = bytes1(uint8(mutatedTx[mutatedTx.length - 1]) ^ 1);
        bytes memory proof =
            abi.encode(uint64(3), uint64(25_881_095), mutatedTx, _merkle(), _continuity());
        vm.expectRevert(ProofVerificationFailed.selector);
        adapter.verifySourceLog(proof, 0);
    }

    function test_merkleProofMutationFails() public {
        MerkleProof memory mutated = _merkle();
        mutated.siblings[0].hash = bytes32(uint256(99));
        bytes memory proof =
            abi.encode(uint64(3), uint64(25_881_095), txBytes, mutated, _continuity());
        vm.expectRevert(ProofVerificationFailed.selector);
        adapter.verifySourceLog(proof, 0);
    }

    function test_continuityProofMutationFails() public {
        ContinuityProof memory mutated = _continuity();
        mutated.roots[1] = bytes32(uint256(99));
        bytes memory proof = abi.encode(uint64(3), uint64(25_881_095), txBytes, _merkle(), mutated);
        vm.expectRevert(ProofVerificationFailed.selector);
        adapter.verifySourceLog(proof, 0);
    }

    function test_truncatedEncodingFails() public {
        vm.expectRevert();
        adapter.verifySourceLog(hex"01", 0);
    }

    function test_wrongChainAndDecoderBoundariesFail() public {
        bytes memory wrongChain =
            abi.encode(uint64(4), uint64(25_881_095), txBytes, _merkle(), _continuity());
        vm.expectRevert(abi.encodeWithSelector(WrongSourceChain.selector, 3, 4));
        adapter.verifySourceLog(wrongChain, 0);

        decoder.setTransactionType(5, true);
        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(uint256(1));
        chunks[1] = abi.encode(uint256(2));
        chunks[2] = abi.encode(uint256(3));
        bytes memory unsupportedTx = abi.encode(uint8(5), chunks);
        prover.setExpectedFingerprint(
            prover.fingerprint(3, 25_881_095, unsupportedTx, _merkle(), _continuity())
        );
        bytes memory proof =
            abi.encode(uint64(3), uint64(25_881_095), unsupportedTx, _merkle(), _continuity());
        vm.expectRevert(abi.encodeWithSelector(UnsupportedTransactionType.selector, 5));
        adapter.verifySourceLog(proof, 0);
    }

    function test_decoderValidityMismatchFails() public {
        decoder.setTransactionType(2, false);
        vm.expectRevert(abi.encodeWithSelector(DecoderRejectedTransaction.selector, 2));
        adapter.verifySourceLog(_encodedProof(), 0);
    }

    function test_goldenDecoderSignedAnswerAndEventId() public {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = TOPIC0;
        topics[1] = bytes32(type(uint256).max - 41); // -42 as signed int256
        topics[2] = bytes32(uint256(7));
        VerifiedSourceLog memory source = VerifiedSourceLog({
            chainKey: 3,
            attestedTransactionDigest: bytes32(uint256(8)),
            receiptLogPosition: 2,
            emitter: EMITTER,
            topics: topics,
            data: abi.encode(uint256(9)),
            receiptSucceeded: true
        });
        OracleObservation memory observation = ChainlinkAnswerUpdated.decode(source);
        assertEq(observation.answer, -42);
        assertEq(observation.roundId, 7);
        assertEq(observation.updatedAt, 9);
        assertEq(
            observation.eventId,
            keccak256(
                abi.encode(
                    keccak256("PEGSHIELD_ATTESTED_EVM_V1_CHAINLINK_LOG_V1"),
                    uint256(3),
                    bytes32(uint256(8)),
                    uint256(2),
                    EMITTER,
                    TOPIC0
                )
            )
        );
    }

    function test_nonChainlinkLogAndMalformedShapeFailPureDecoder() public {
        bytes32[] memory wrongTopic = new bytes32[](3);
        wrongTopic[0] = bytes32(uint256(123));
        wrongTopic[1] = bytes32(uint256(1));
        wrongTopic[2] = bytes32(uint256(2));
        VerifiedSourceLog memory source = VerifiedSourceLog({
            chainKey: 3,
            attestedTransactionDigest: bytes32(uint256(8)),
            receiptLogPosition: 0,
            emitter: EMITTER,
            topics: wrongTopic,
            data: abi.encode(uint256(9)),
            receiptSucceeded: true
        });
        vm.expectRevert(abi.encodeWithSelector(WrongEventSignature.selector, wrongTopic[0]));
        this.decodeForTest(source);

        source.topics = new bytes32[](2);
        vm.expectRevert(MalformedOracleLog.selector);
        this.decodeForTest(source);
    }

    function decodeForTest(VerifiedSourceLog calldata source)
        external
        pure
        returns (OracleObservation memory)
    {
        return ChainlinkAnswerUpdated.decode(source);
    }
}
