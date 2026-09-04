// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The lifecycle states a purchased PegShield policy can occupy.
enum PolicyState {
    Active,
    BreachObserved,
    Claimed,
    Expired
}

/// @notice Terms fixed by an underwriter when a product is created.
struct Product {
    uint256 chainKey;
    address aggregator;
    uint8 feedDecimals;
    int256 triggerBelow;
    uint64 activationDelay;
    uint64 policyDuration;
    uint64 claimGracePeriod;
    uint64 minBreachDuration;
    uint32 premiumBps;
    uint256 maxCoveragePerPolicy;
    bool enabled;
}

/// @notice Terms and state captured at policy purchase time.
struct Policy {
    uint256 productId;
    address holder;
    address beneficiary;
    uint256 coverage;
    uint256 premium;
    uint64 purchasedAt;
    uint64 startsAt;
    uint64 endsAt;
    uint64 firstBreachAt;
    uint256 firstRoundId;
    bytes32 firstEventId;
    PolicyState state;
}

/// @notice Authenticated source-log envelope returned by the verifier adapter.
/// @dev The adapter is the only production component that knows proof encoding.
struct VerifiedSourceLog {
    uint256 chainKey;
    /// @dev keccak256 of the exact EVM-v1 encoded transaction-and-receipt
    /// envelope authenticated by BlockProver; this is not the Ethereum RPC
    /// transaction hash.
    bytes32 attestedTransactionDigest;
    uint256 receiptLogPosition;
    address emitter;
    bytes32[] topics;
    bytes data;
    bool receiptSucceeded;
}

/// @notice Chainlink observation decoded from a verified AnswerUpdated log.
struct OracleObservation {
    bytes32 eventId;
    int256 answer;
    uint256 roundId;
    uint256 updatedAt;
}

// Shared protocol errors. Keeping names in one file makes ABI/UI generation
// deterministic across the pool, adapter, and worker packages.
error ZeroAddress();
error ZeroAmount();
error UnknownProduct(uint256 productId);
error UnknownPolicy(uint256 policyId);
error ProductDisabled(uint256 productId);
error ProductAlreadyDisabled(uint256 productId);
error InvalidProductConfig();
error CoverageAboveProductMaximum(uint256 coverage, uint256 maximum);
error InsufficientFreeCapital(uint256 requested, uint256 available);
error UnexpectedTokenBalanceDelta(uint256 expected, uint256 actual);
error PolicyNotActive(uint256 policyId, uint8 state);
error PolicyNotExpirable(uint256 policyId, uint8 state);
error ClaimSubmissionClosed(uint256 nowTimestamp, uint256 deadline);
error WrongSourceChain(uint256 expected, uint256 actual);
error WrongEmitter(address expected, address actual);
error WrongEventSignature(bytes32 actual);
error MalformedOracleLog();
error SourceTransactionFailed();
error InvalidOracleAnswer(int256 answer);
error ThresholdNotBreached(int256 answer, int256 triggerBelow);
error SourceEventOutsideCoverage(uint256 updatedAt, uint256 startsAt, uint256 endsAt);
error EventAlreadyConsumed(bytes32 eventId);
error ConfirmationEventNotLater();
error BreachDurationNotMet(uint256 updatedAt, uint256 requiredAt);
error ExpiryTooEarly(uint256 nowTimestamp, uint256 deadline);
error TimestampOverflow(uint256 value);
