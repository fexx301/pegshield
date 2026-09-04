// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {
    ContinuityProof,
    IAttestcoinBlockProver,
    IEvmV1Decoder,
    MerkleProof
} from "../../src/AttestcoinVerifierAdapter.sol";
import { IPegShieldVerifier } from "../../src/interfaces/IPegShieldVerifier.sol";
import { VerifiedSourceLog } from "../../src/PegShieldTypes.sol";

error UnexpectedEncodedTransaction(bytes32 expected, bytes32 actual);

/// @dev Test-only verifier that requires the complete proof envelope to match
/// a configured fingerprint. This catches adapter argument truncation and
/// mutation without placing a fake verifier in production `src`.
contract MockAttestcoinBlockProver is IAttestcoinBlockProver {
    bytes32 public expectedFingerprint;

    function setExpectedFingerprint(bytes32 value) external {
        expectedFingerprint = value;
    }

    function fingerprint(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external pure returns (bytes32) {
        return _fingerprint(chainKey, height, encodedTransaction, merkleProof, continuityProof);
    }

    function verify(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external view returns (bool) {
        return expectedFingerprint
            == _fingerprint(chainKey, height, encodedTransaction, merkleProof, continuityProof);
    }

    function _fingerprint(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) private pure returns (bytes32 result) {
        result = keccak256(abi.encode(chainKey, height, encodedTransaction, merkleProof.root));
        for (uint256 i; i < merkleProof.siblings.length; ++i) {
            result = keccak256(
                abi.encode(result, merkleProof.siblings[i].hash, merkleProof.siblings[i].isLeft)
            );
        }
        result = keccak256(abi.encode(result, continuityProof.lowerEndpointDigest));
        for (uint256 i; i < continuityProof.roots.length; ++i) {
            result = keccak256(abi.encode(result, continuityProof.roots[i]));
        }
    }
}

/// @dev Test-only receipt decoder returning configurable EVM-v1 log entries.
contract MockEvmV1Decoder is IEvmV1Decoder {
    uint8 public txType = 2;
    bool public valid = true;
    uint8 public receiptStatus = 1;
    address public logAddress;
    bytes32[] private logTopics;
    bytes private logData;
    bytes32 public expectedEncodedTransactionHash;

    function setTransactionType(uint8 value, bool isValid) external {
        txType = value;
        valid = isValid;
    }

    function setReceipt(
        uint8 status,
        address emitter,
        bytes32[] calldata topics,
        bytes calldata data
    ) external {
        receiptStatus = status;
        logAddress = emitter;
        delete logTopics;
        for (uint256 i; i < topics.length; ++i) {
            logTopics.push(topics[i]);
        }
        logData = data;
    }

    function setExpectedEncodedTransaction(bytes32 encodedTransactionHash) external {
        expectedEncodedTransactionHash = encodedTransactionHash;
    }

    function getTransactionType(bytes calldata) external view returns (uint8) {
        return txType;
    }

    function isValidTransactionType(uint8) external view returns (bool) {
        return valid;
    }

    function decodeReceiptFields(bytes calldata encodedTx)
        external
        view
        returns (ReceiptFields memory receipt)
    {
        bytes32 actualEncodedTransactionHash = keccak256(encodedTx);
        if (
            expectedEncodedTransactionHash != bytes32(0)
                && actualEncodedTransactionHash != expectedEncodedTransactionHash
        ) {
            revert UnexpectedEncodedTransaction(
                expectedEncodedTransactionHash, actualEncodedTransactionHash
            );
        }
        LogEntry[] memory logs = new LogEntry[](1);
        bytes32[] memory topics = new bytes32[](logTopics.length);
        for (uint256 i; i < logTopics.length; ++i) {
            topics[i] = logTopics[i];
        }
        logs[0] = LogEntry({ address_: logAddress, topics: topics, data: logData });
        receipt = ReceiptFields({
            receiptStatus: receiptStatus,
            receiptGasUsed: 21_000,
            receiptLogs: logs,
            receiptLogsBloom: new bytes(256)
        });
    }
}

/// @dev Test-only pool boundary stub. It returns a caller-configured
/// authenticated envelope; no production contract imports this mock.
contract MockPegShieldVerifier is IPegShieldVerifier {
    VerifiedSourceLog private source;
    mapping(bytes32 proofHash => VerifiedSourceLog keyedSource) private keyedSources;
    mapping(bytes32 proofHash => bool configured) private keyedSourceConfigured;

    function setSource(
        uint256 chainKey,
        bytes32 attestedTransactionDigest,
        uint256 receiptLogPosition,
        address emitter,
        bytes32[] calldata topics,
        bytes calldata data,
        bool receiptSucceeded
    ) external {
        source.chainKey = chainKey;
        source.attestedTransactionDigest = attestedTransactionDigest;
        source.receiptLogPosition = receiptLogPosition;
        source.emitter = emitter;
        delete source.topics;
        for (uint256 i; i < topics.length; ++i) {
            source.topics.push(topics[i]);
        }
        source.data = data;
        source.receiptSucceeded = receiptSucceeded;
    }

    function setSourceForProof(
        bytes calldata encodedProof,
        uint256 chainKey,
        bytes32 attestedTransactionDigest,
        uint256 receiptLogPosition,
        address emitter,
        bytes32[] calldata topics,
        bytes calldata data,
        bool receiptSucceeded
    ) external {
        bytes32 proofHash = keccak256(encodedProof);
        VerifiedSourceLog storage keyed = keyedSources[proofHash];
        keyed.chainKey = chainKey;
        keyed.attestedTransactionDigest = attestedTransactionDigest;
        keyed.receiptLogPosition = receiptLogPosition;
        keyed.emitter = emitter;
        delete keyed.topics;
        for (uint256 i; i < topics.length; ++i) {
            keyed.topics.push(topics[i]);
        }
        keyed.data = data;
        keyed.receiptSucceeded = receiptSucceeded;
        keyedSourceConfigured[proofHash] = true;
    }

    function verifySourceLog(bytes calldata encodedProof, uint256)
        external
        view
        returns (VerifiedSourceLog memory)
    {
        bytes32 proofHash = keccak256(encodedProof);
        if (keyedSourceConfigured[proofHash]) return keyedSources[proofHash];
        return source;
    }
}
