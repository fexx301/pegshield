// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IAttestcoinVerifier } from "./IAttestcoinVerifier.sol";
import { VerifiedSourceLog, ZeroAddress, WrongSourceChain } from "./PegShieldTypes.sol";

error InvalidProofEncoding();
error ProofVerificationFailed();
error UnsupportedTransactionType(uint8 txType);
error DecoderRejectedTransaction(uint8 txType);
error ReceiptLogOutOfBounds(uint256 requested, uint256 available);

/// @dev These structs mirror the exact BlockProver tuple but are kept private
/// to this adapter source file so business contracts never depend on them.
struct MerkleProofEntry {
    bytes32 hash;
    bool isLeft;
}

struct MerkleProof {
    bytes32 root;
    MerkleProofEntry[] siblings;
}

struct ContinuityProof {
    bytes32 lowerEndpointDigest;
    bytes32[] roots;
}

/// @dev Exact single-proof interface discovered from `@gluwa/usc-sdk@0.18.0`.
interface IAttestcoinBlockProver {
    function verify(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external view returns (bool);
}

/// @dev Exact EVM-v1 receipt decoder surface at the discovered CC3 decoder.
interface IEvmV1Decoder {
    struct LogEntry {
        address address_;
        bytes32[] topics;
        bytes data;
    }

    struct ReceiptFields {
        uint8 receiptStatus;
        uint64 receiptGasUsed;
        LogEntry[] receiptLogs;
        bytes receiptLogsBloom;
    }

    function getTransactionType(bytes calldata encodedTx) external view returns (uint8 txType);

    function isValidTransactionType(uint8 txType) external view returns (bool);

    /// @dev The deployed CC3 decoder accepts the authenticated
    /// `(uint8,bytes[])` transaction envelope here and extracts the receipt
    /// fields from its final chunk. Although the SDK's ABI encoder documents
    /// the receipt chunk as a standalone ABI value, passing that chunk alone
    /// reverts on the discovered decoder deployment.
    function decodeReceiptFields(bytes calldata encodedTx)
        external
        view
        returns (ReceiptFields memory receipt);
}

/// @title AttestcoinVerifierAdapter
/// @notice Verifies an official Attestcoin proof and exposes one authenticated
/// receipt log to the PegShield business contract.
/// @dev Only this contract knows the discovered `(chainKey,height,txBytes,
/// merkleProof,continuityProof)` tuple and EVM-v1 chunk layout. The pool sees
/// only opaque bytes and `VerifiedSourceLog`.
contract AttestcoinVerifierAdapter is IAttestcoinVerifier {
    uint64 public constant SUPPORTED_CHAIN_KEY = 3;

    address public immutable blockProver;
    address public immutable decoder;

    constructor(address blockProver_, address decoder_) {
        if (blockProver_ == address(0)) revert ZeroAddress();
        if (decoder_ == address(0)) revert ZeroAddress();
        blockProver = blockProver_;
        decoder = decoder_;
    }

    function verifySourceLog(bytes calldata encodedProof, uint256 receiptLogPosition)
        external
        view
        returns (VerifiedSourceLog memory source)
    {
        if (encodedProof.length == 0) revert InvalidProofEncoding();

        // This is the exact ABI shape used by BlockProver.verify in the
        // discovered SDK. It intentionally has no caller-provided emitter,
        // answer, timestamp, topic, transaction hash, or log index.
        (
            uint64 chainKey,
            uint64 height,
            bytes memory encodedTransaction,
            MerkleProof memory merkleProof,
            ContinuityProof memory continuityProof
        ) = abi.decode(encodedProof, (uint64, uint64, bytes, MerkleProof, ContinuityProof));
        if (chainKey != SUPPORTED_CHAIN_KEY) {
            revert WrongSourceChain(SUPPORTED_CHAIN_KEY, chainKey);
        }

        bool proofValid = IAttestcoinBlockProver(blockProver)
            .verify(chainKey, height, encodedTransaction, merkleProof, continuityProof);
        if (!proofValid) revert ProofVerificationFailed();

        (uint8 txType, bytes[] memory chunks) = abi.decode(encodedTransaction, (uint8, bytes[]));
        IEvmV1Decoder decoderContract = IEvmV1Decoder(decoder);
        if (decoderContract.getTransactionType(encodedTransaction) != txType) {
            revert DecoderRejectedTransaction(txType);
        }
        if (txType > 4) revert UnsupportedTransactionType(txType);
        if (!decoderContract.isValidTransactionType(txType)) {
            revert DecoderRejectedTransaction(txType);
        }

        uint256 expectedChunks = txType <= 2 ? 3 : 4;
        if (chunks.length != expectedChunks) revert InvalidProofEncoding();
        // The live CC3 decoder's receipt entry point operates on the complete
        // authenticated envelope, not on the final bytes[] element. Keeping
        // the chunk-count check above still prevents malformed or unsupported
        // envelopes from crossing the proof boundary.
        IEvmV1Decoder.ReceiptFields memory receipt =
            decoderContract.decodeReceiptFields(encodedTransaction);
        if (receiptLogPosition >= receipt.receiptLogs.length) {
            revert ReceiptLogOutOfBounds(receiptLogPosition, receipt.receiptLogs.length);
        }

        IEvmV1Decoder.LogEntry memory log = receipt.receiptLogs[receiptLogPosition];
        source = VerifiedSourceLog({
            chainKey: chainKey,
            // The official verifier authenticates the encoded transaction
            // commitment, not an independently supplied RPC hash. This hash
            // is therefore the canonical source-transaction identifier used
            // for replay protection and event IDs.
            attestedTransactionDigest: keccak256(encodedTransaction),
            receiptLogPosition: receiptLogPosition,
            emitter: log.address_,
            topics: log.topics,
            data: log.data,
            receiptSucceeded: receipt.receiptStatus == 1
        });
    }
}
