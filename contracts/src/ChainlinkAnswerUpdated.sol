// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {
    MalformedOracleLog,
    OracleObservation,
    VerifiedSourceLog,
    WrongEventSignature
} from "./PegShieldTypes.sol";

/// @notice Pure decoder for the pinned Chainlink AnswerUpdated event shape.
/// @dev This library knows nothing about Attestcoin proof bytes. It receives
/// only the authenticated source-log envelope produced by the adapter.
library ChainlinkAnswerUpdated {
    bytes32 internal constant EVENT_ID_DOMAIN =
        keccak256("PEGSHIELD_ATTESTED_EVM_V1_CHAINLINK_LOG_V1");
    bytes32 internal constant TOPIC0 =
        0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f;

    function decode(VerifiedSourceLog memory source)
        internal
        pure
        returns (OracleObservation memory observation)
    {
        if (source.topics.length != 3 || source.data.length != 32) {
            revert MalformedOracleLog();
        }
        if (source.topics[0] != TOPIC0) {
            revert WrongEventSignature(source.topics[0]);
        }

        // The first indexed argument is a signed int256. Assigning the raw
        // word in assembly preserves its two's-complement representation.
        int256 answer;
        bytes32 answerWord = source.topics[1];
        assembly {
            answer := answerWord
        }

        observation = OracleObservation({
            eventId: keccak256(
                abi.encode(
                    EVENT_ID_DOMAIN,
                    source.chainKey,
                    source.attestedTransactionDigest,
                    source.receiptLogPosition,
                    source.emitter,
                    source.topics[0]
                )
            ),
            answer: answer,
            roundId: uint256(source.topics[2]),
            updatedAt: abi.decode(source.data, (uint256))
        });
    }
}
