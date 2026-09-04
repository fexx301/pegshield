// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IPegShieldVerifier } from "./interfaces/IPegShieldVerifier.sol";
import { ChainlinkAnswerUpdated } from "./ChainlinkAnswerUpdated.sol";
import {
    OracleObservation,
    Policy,
    PolicyState,
    Product,
    VerifiedSourceLog,
    ZeroAddress,
    ZeroAmount,
    UnknownProduct,
    UnknownPolicy,
    ProductDisabled as ProductDisabledError,
    ProductAlreadyDisabled,
    InvalidProductConfig,
    InsufficientFreeCapital,
    UnexpectedTokenBalanceDelta,
    CoverageAboveProductMaximum,
    TimestampOverflow,
    PolicyNotActive,
    PolicyNotExpirable,
    ClaimSubmissionClosed,
    WrongSourceChain,
    WrongEmitter,
    MalformedOracleLog,
    SourceTransactionFailed,
    InvalidOracleAnswer,
    ThresholdNotBreached,
    SourceEventOutsideCoverage,
    EventAlreadyConsumed,
    ConfirmationEventNotLater,
    BreachDurationNotMet,
    ExpiryTooEarly
} from "./PegShieldTypes.sol";

/// @title PegShieldPool
/// @notice Accounted TestUSD capital and underwriter-defined depeg-cover products.
/// The verifier address is immutable from deployment so an underwriter cannot
/// swap the proof boundary underneath policies that already exist.
contract PegShieldPool is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant UNDERWRITER_ROLE = keccak256("UNDERWRITER_ROLE");
    uint256 public constant REGISTERED_SOURCE_CHAIN_KEY = 3;
    uint8 public constant REGISTERED_FEED_DECIMALS = 8;
    uint64 public constant MIN_ACTIVATION_DELAY = 5 minutes;
    uint32 public constant MAX_PREMIUM_BPS = 9_999;

    IERC20 public immutable payoutToken;
    address public immutable verifierAdapter;

    uint256 public accountedCapital;
    uint256 public reservedCapital;
    uint256 public nextProductId = 1;
    uint256 public nextPolicyId = 1;

    mapping(uint256 productId => Product product) private products;
    mapping(uint256 policyId => Policy policy) private policies;
    mapping(uint256 policyId => mapping(bytes32 eventId => bool consumed)) public
        eventConsumedByPolicy;

    event PoolFunded(address indexed funder, uint256 amount);
    event CapitalWithdrawn(address indexed recipient, uint256 amount);
    event ProductCreated(uint256 indexed productId, address indexed aggregator);
    event ProductDisabled(uint256 indexed productId);
    event PolicyPurchased(
        uint256 indexed policyId,
        uint256 indexed productId,
        address indexed holder,
        address beneficiary,
        uint256 coverage,
        uint256 premium,
        uint64 startsAt,
        uint64 endsAt
    );
    event BreachObserved(
        uint256 indexed policyId,
        bytes32 indexed eventId,
        uint256 roundId,
        int256 answer,
        uint256 sourceTimestamp
    );
    event ConfirmationObserved(
        uint256 indexed policyId,
        bytes32 indexed eventId,
        uint256 roundId,
        int256 answer,
        uint256 sourceTimestamp
    );
    event PolicyPaid(uint256 indexed policyId, address indexed beneficiary, uint256 amount);
    event PolicyExpired(uint256 indexed policyId, uint256 reserveReleased);

    constructor(IERC20 payoutToken_, address verifierAdapter_, address underwriter_) {
        if (address(payoutToken_) == address(0)) revert ZeroAddress();
        if (verifierAdapter_ == address(0)) revert ZeroAddress();
        if (underwriter_ == address(0)) revert ZeroAddress();

        payoutToken = payoutToken_;
        verifierAdapter = verifierAdapter_;
        _grantRole(DEFAULT_ADMIN_ROLE, underwriter_);
        _grantRole(UNDERWRITER_ROLE, underwriter_);
    }

    /// @notice Deposits exactly `amount` payout tokens into accounted capital.
    /// @dev Fee-on-transfer and rebasing behavior is intentionally unsupported.
    function fundPool(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _pullExact(msg.sender, amount);
        accountedCapital += amount;
        emit PoolFunded(msg.sender, amount);
    }

    /// @notice Withdraws only unreserved accounted capital.
    function withdrawFreeCapital(uint256 amount, address recipient)
        external
        nonReentrant
        onlyRole(UNDERWRITER_ROLE)
    {
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        uint256 available = availableCapital();
        if (amount > available) revert InsufficientFreeCapital(amount, available);

        // Effects precede the external token transfer so a malicious token
        // cannot observe stale accounting during a callback.
        accountedCapital -= amount;
        _pushExact(recipient, amount);
        emit CapitalWithdrawn(recipient, amount);
    }

    /// @notice Returns capital that is not reserved for active policies.
    function availableCapital() public view returns (uint256) {
        return accountedCapital - reservedCapital;
    }

    /// @notice Quotes the one-time premium using upward rounding.
    function quotePremium(uint256 productId, uint256 coverage) public view returns (uint256) {
        Product storage product = _productStorage(productId);
        if (coverage > product.maxCoveragePerPolicy) {
            revert CoverageAboveProductMaximum(coverage, product.maxCoveragePerPolicy);
        }
        return Math.mulDiv(coverage, product.premiumBps, 10_000, Math.Rounding.Ceil);
    }

    /// @notice Purchases a product and reserves the requested coverage.
    function buyPolicy(uint256 productId, uint256 coverage, address beneficiary)
        external
        nonReentrant
        returns (uint256 policyId)
    {
        Product storage product = _productStorage(productId);
        if (!product.enabled) revert ProductDisabledError(productId);
        if (coverage == 0) revert ZeroAmount();
        if (beneficiary == address(0)) revert ZeroAddress();
        if (coverage > product.maxCoveragePerPolicy) {
            revert CoverageAboveProductMaximum(coverage, product.maxCoveragePerPolicy);
        }

        uint256 premium = Math.mulDiv(coverage, product.premiumBps, 10_000, Math.Rounding.Ceil);
        _requirePurchaseCapacity(coverage, premium);
        (uint64 purchasedAt, uint64 startsAt, uint64 endsAt) = _purchaseTimes(product);

        _pullExact(msg.sender, premium);
        accountedCapital += premium;
        reservedCapital += coverage;

        policyId = nextPolicyId++;
        Policy storage policy = policies[policyId];
        policy.productId = productId;
        policy.holder = msg.sender;
        policy.beneficiary = beneficiary;
        policy.coverage = coverage;
        policy.premium = premium;
        policy.purchasedAt = purchasedAt;
        policy.startsAt = startsAt;
        policy.endsAt = endsAt;
        policy.state = PolicyState.Active;

        emit PolicyPurchased(
            policyId, productId, msg.sender, beneficiary, coverage, premium, startsAt, endsAt
        );
    }

    /// @notice Atomically verifies two ordered in-window breaches and pays the beneficiary.
    /// @dev Verifying both observations in one transaction prevents a permissionless
    /// relayer from griefing a policy by pinning an unusably late first observation.
    function submitClaim(
        uint256 policyId,
        bytes calldata firstEncodedProof,
        uint256 firstReceiptLogPosition,
        bytes calldata confirmationEncodedProof,
        uint256 confirmationReceiptLogPosition
    ) external nonReentrant {
        Policy storage policy = _policyStorage(policyId);
        if (policy.state != PolicyState.Active) {
            revert PolicyNotActive(policyId, uint8(policy.state));
        }
        Product storage product = _productStorage(policy.productId);
        _requireSubmissionOpen(policy, product);

        OracleObservation memory first =
            _verifyObservation(policy, product, firstEncodedProof, firstReceiptLogPosition);
        OracleObservation memory confirmation = _verifyObservation(
            policy, product, confirmationEncodedProof, confirmationReceiptLogPosition
        );
        if (eventConsumedByPolicy[policyId][first.eventId]) {
            revert EventAlreadyConsumed(first.eventId);
        }
        if (
            confirmation.eventId == first.eventId || confirmation.roundId <= first.roundId
                || confirmation.updatedAt <= first.updatedAt
        ) {
            revert ConfirmationEventNotLater();
        }
        uint256 requiredAt = first.updatedAt + product.minBreachDuration;
        if (confirmation.updatedAt < requiredAt) {
            revert BreachDurationNotMet(confirmation.updatedAt, requiredAt);
        }
        if (eventConsumedByPolicy[policyId][confirmation.eventId]) {
            revert EventAlreadyConsumed(confirmation.eventId);
        }

        eventConsumedByPolicy[policyId][first.eventId] = true;
        eventConsumedByPolicy[policyId][confirmation.eventId] = true;
        policy.firstBreachAt = _toUint64(first.updatedAt);
        policy.firstRoundId = first.roundId;
        policy.firstEventId = first.eventId;
        policy.state = PolicyState.Claimed;
        reservedCapital -= policy.coverage;
        accountedCapital -= policy.coverage;
        _pushExact(policy.beneficiary, policy.coverage);

        emit BreachObserved(policyId, first.eventId, first.roundId, first.answer, first.updatedAt);
        emit ConfirmationObserved(
            policyId,
            confirmation.eventId,
            confirmation.roundId,
            confirmation.answer,
            confirmation.updatedAt
        );
        emit PolicyPaid(policyId, policy.beneficiary, policy.coverage);
    }

    /// @notice Expires an unclaimed policy strictly after its claim deadline.
    function expirePolicy(uint256 policyId) external nonReentrant {
        Policy storage policy = _policyStorage(policyId);
        if (policy.state != PolicyState.Active && policy.state != PolicyState.BreachObserved) {
            revert PolicyNotExpirable(policyId, uint8(policy.state));
        }
        Product storage product = _productStorage(policy.productId);
        uint256 deadline = uint256(policy.endsAt) + product.claimGracePeriod;
        if (block.timestamp <= deadline) revert ExpiryTooEarly(block.timestamp, deadline);

        policy.state = PolicyState.Expired;
        reservedCapital -= policy.coverage;
        emit PolicyExpired(policyId, policy.coverage);
    }

    /// @notice Creates immutable terms for a new product. Only sales can later
    /// be disabled; existing policy terms are never edited.
    function createProduct(Product calldata config)
        external
        onlyRole(UNDERWRITER_ROLE)
        returns (uint256 productId)
    {
        _validateProduct(config);
        productId = nextProductId++;
        products[productId] = config;
        emit ProductCreated(productId, config.aggregator);
    }

    /// @notice Permanently disables new purchases for a product.
    function disableProduct(uint256 productId) external onlyRole(UNDERWRITER_ROLE) {
        Product storage product = _productStorage(productId);
        if (!product.enabled) revert ProductAlreadyDisabled(productId);
        product.enabled = false;
        emit ProductDisabled(productId);
    }

    function getProduct(uint256 productId) external view returns (Product memory) {
        Product storage product = _productStorage(productId);
        return product;
    }

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        Policy storage policy = policies[policyId];
        if (policy.productId == 0) revert UnknownPolicy(policyId);
        return policy;
    }

    function _policyStorage(uint256 policyId) internal view returns (Policy storage policy) {
        policy = policies[policyId];
        if (policy.productId == 0) revert UnknownPolicy(policyId);
    }

    function _requireSubmissionOpen(Policy storage policy, Product storage product) internal view {
        uint256 deadline = uint256(policy.endsAt) + product.claimGracePeriod;
        if (block.timestamp > deadline) {
            revert ClaimSubmissionClosed(block.timestamp, deadline);
        }
    }

    function _requirePurchaseCapacity(uint256 coverage, uint256 premium) internal view {
        uint256 available = availableCapital();
        if (premium > type(uint256).max - available) {
            revert InsufficientFreeCapital(coverage, available);
        }
        uint256 postPremiumBacking = available + premium;
        if (coverage > postPremiumBacking) {
            revert InsufficientFreeCapital(coverage, postPremiumBacking);
        }
    }

    function _purchaseTimes(Product storage product)
        internal
        view
        returns (uint64 purchasedAt, uint64 startsAt, uint64 endsAt)
    {
        uint256 purchased = block.timestamp;
        uint256 starts = purchased + product.activationDelay;
        uint256 ends = starts + product.policyDuration;
        purchasedAt = _toUint64(purchased);
        startsAt = _toUint64(starts);
        endsAt = _toUint64(ends);
    }

    function _verifyObservation(
        Policy storage policy,
        Product storage product,
        bytes calldata encodedProof,
        uint256 receiptLogPosition
    ) internal view returns (OracleObservation memory observation) {
        VerifiedSourceLog memory source = IPegShieldVerifier(verifierAdapter)
            .verifySourceLog(encodedProof, receiptLogPosition);
        if (!source.receiptSucceeded) revert SourceTransactionFailed();
        if (source.chainKey != product.chainKey) {
            revert WrongSourceChain(product.chainKey, source.chainKey);
        }
        if (source.emitter != product.aggregator) {
            revert WrongEmitter(product.aggregator, source.emitter);
        }
        if (source.receiptLogPosition != receiptLogPosition) revert MalformedOracleLog();
        observation = ChainlinkAnswerUpdated.decode(source);
        if (observation.answer <= 0) revert InvalidOracleAnswer(observation.answer);
        if (observation.answer >= product.triggerBelow) {
            revert ThresholdNotBreached(observation.answer, product.triggerBelow);
        }
        if (observation.updatedAt < policy.startsAt || observation.updatedAt > policy.endsAt) {
            revert SourceEventOutsideCoverage(observation.updatedAt, policy.startsAt, policy.endsAt);
        }
    }

    function _pullExact(address from, uint256 amount) internal {
        uint256 beforeBalance = payoutToken.balanceOf(address(this));
        payoutToken.safeTransferFrom(from, address(this), amount);
        uint256 afterBalance = payoutToken.balanceOf(address(this));
        if (afterBalance < beforeBalance) {
            revert UnexpectedTokenBalanceDelta(amount, 0);
        }
        uint256 actual = afterBalance - beforeBalance;
        if (actual != amount) revert UnexpectedTokenBalanceDelta(amount, actual);
    }

    function _productStorage(uint256 productId) internal view returns (Product storage product) {
        product = products[productId];
        if (product.chainKey == 0) revert UnknownProduct(productId);
    }

    function _validateProduct(Product calldata config) internal pure {
        if (
            config.chainKey != REGISTERED_SOURCE_CHAIN_KEY || config.aggregator == address(0)
                || config.feedDecimals != REGISTERED_FEED_DECIMALS || config.triggerBelow <= 0
                || config.activationDelay < MIN_ACTIVATION_DELAY || config.policyDuration == 0
                || config.claimGracePeriod == 0 || config.minBreachDuration == 0
                || config.minBreachDuration >= config.policyDuration || config.premiumBps == 0
                || config.premiumBps > MAX_PREMIUM_BPS || config.maxCoveragePerPolicy == 0
                || !config.enabled
        ) {
            revert InvalidProductConfig();
        }
    }

    function _toUint64(uint256 value) internal pure returns (uint64 result) {
        if (value > type(uint64).max) revert TimestampOverflow(value);
        assembly {
            result := value
        }
    }

    function _pushExact(address recipient, uint256 amount) internal {
        uint256 beforeBalance = payoutToken.balanceOf(recipient);
        payoutToken.safeTransfer(recipient, amount);
        uint256 afterBalance = payoutToken.balanceOf(recipient);
        if (afterBalance < beforeBalance) {
            revert UnexpectedTokenBalanceDelta(amount, 0);
        }
        uint256 actual = afterBalance - beforeBalance;
        if (actual != amount) revert UnexpectedTokenBalanceDelta(amount, actual);
    }
}
