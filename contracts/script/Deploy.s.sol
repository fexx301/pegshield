// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Script } from "forge-std/Script.sol";
import { TestUSD } from "../src/TestUSD.sol";
import {
    AttestcoinVerifierAdapter,
    MerkleProof,
    MerkleProofEntry,
    ContinuityProof
} from "../src/AttestcoinVerifierAdapter.sol";
import { PegShieldPool } from "../src/PegShieldPool.sol";
import { Product } from "../src/PegShieldTypes.sol";

/// @title PegShield CC3 deployment script
/// @notice Deterministic deployment order with fail-closed CC3 preflight.
/// @dev No private key or address is embedded. All credentials and operator
/// addresses are supplied through Foundry environment variables at runtime.
contract Deploy is Script {
    uint256 internal constant CC3_CHAIN_ID = 102031;
    uint256 internal constant CHAIN_KEY = 3;
    address internal constant BLOCK_PROVER = 0x0000000000000000000000000000000000000FD2;
    address internal constant DECODER = 0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f;
    address internal constant SOURCE_AGGREGATOR = 0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7;
    uint256 internal constant FIXTURE_SIBLING_COUNT = 9;
    bytes32 internal constant DECODER_CODE_HASH =
        0xb549c9d8eaf7d361192f8e363fe98717464441e2dd26e2b3bd1e0725df73a065;

    struct DeploymentConfig {
        uint256 deployerKey;
        uint256 underwriterKey;
        uint256 policyholderKey;
        address deployer;
        address underwriter;
        address policyholder;
        address demoMinter;
    }

    error WrongNetwork(uint256 actual);
    error MissingDependency(address dependency);
    error DependencyCodeHashMismatch(bytes32 expected, bytes32 actual);
    error DependencyReadFailed(address dependency);
    error InsufficientNativeBalance(address account);
    error InvalidOperator(address expected, address actual);
    error ValueDoesNotFitUint64(string field, uint256 value);
    error ValueDoesNotFitUint32(string field, uint256 value);
    error ValueDoesNotFitInt256(string field, uint256 value);
    error InvalidSourceAggregator(address expected, address actual);
    error FinalDeploymentManifestExists();

    function run()
        external
        returns (TestUSD token, AttestcoinVerifierAdapter adapter, PegShieldPool pool)
    {
        if (block.chainid != CC3_CHAIN_ID) revert WrongNetwork(block.chainid);
        // A deployment manifest is an immutable evidence record. For a
        // superseding CC3 rehearsal, callers may select a new manifest path
        // (for example `../deployments/cc3-testnet-v2.json`) while retaining
        // the original v1 record.
        string memory manifestPath =
            vm.envOr("DEPLOYMENT_MANIFEST_PATH", string("../deployments/cc3-testnet.json"));
        if (vm.exists(manifestPath)) {
            revert FinalDeploymentManifestExists();
        }

        DeploymentConfig memory config = _readDeploymentConfig();
        _assertVerifierDependencies();
        address configuredAggregator = vm.envAddress("SOURCE_AGGREGATOR");
        if (configuredAggregator != SOURCE_AGGREGATOR) {
            revert InvalidSourceAggregator(SOURCE_AGGREGATOR, configuredAggregator);
        }

        (token, adapter, pool) = _deploy(config);
    }

    function _readDeploymentConfig() internal view returns (DeploymentConfig memory config) {
        config.deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        config.underwriterKey = vm.envUint("UNDERWRITER_PRIVATE_KEY");
        config.policyholderKey = vm.envUint("POLICYHOLDER_PRIVATE_KEY");
        config.deployer = vm.addr(config.deployerKey);
        config.underwriter = vm.addr(config.underwriterKey);
        config.policyholder = vm.addr(config.policyholderKey);
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        config.demoMinter = vm.envAddress("DEMO_MINTER_ADDRESS");
        if (
            config.deployer.balance == 0 || config.underwriter.balance == 0
                || config.policyholder.balance == 0
        ) {
            revert InsufficientNativeBalance(config.deployer.balance == 0
                    ? config.deployer
                    : config.underwriter.balance == 0 ? config.underwriter : config.policyholder);
        }
        address expectedDeployer = vm.envAddress("DEPLOYER_ADDRESS");
        if (expectedDeployer != config.deployer) {
            revert InvalidOperator(expectedDeployer, config.deployer);
        }
        address expectedUnderwriter = vm.envAddress("UNDERWRITER_ADDRESS");
        if (expectedUnderwriter != config.underwriter) {
            revert InvalidOperator(expectedUnderwriter, config.underwriter);
        }
        address expectedPolicyholder = vm.envAddress("POLICYHOLDER_ADDRESS");
        if (expectedPolicyholder != config.policyholder) {
            revert InvalidOperator(expectedPolicyholder, config.policyholder);
        }
        if (treasury == address(0)) revert InvalidOperator(address(1), treasury);
    }

    function _deploy(DeploymentConfig memory config)
        internal
        returns (TestUSD token, AttestcoinVerifierAdapter adapter, PegShieldPool pool)
    {
        vm.startBroadcast(config.deployerKey);
        token = new TestUSD(config.deployer);
        adapter = new AttestcoinVerifierAdapter(BLOCK_PROVER, DECODER);
        pool = new PegShieldPool(token, address(adapter), config.underwriter);
        if (config.demoMinter != config.deployer) {
            token.grantRole(token.MINTER_ROLE(), config.demoMinter);
        }
        token.mint(config.underwriter, vm.envUint("DEMO_LIQUIDITY"));
        token.mint(config.policyholder, vm.envUint("DEMO_POLICYHOLDER_BALANCE"));
        vm.stopBroadcast();

        vm.startBroadcast(config.underwriterKey);
        token.approve(address(pool), type(uint256).max);
        pool.fundPool(vm.envUint("DEMO_LIQUIDITY"));
        pool.createProduct(_product());
        vm.stopBroadcast();

        vm.startBroadcast(config.policyholderKey);
        token.approve(address(pool), type(uint256).max);
        pool.buyPolicy(1, vm.envUint("DEMO_COVERAGE"), config.policyholder);
        vm.stopBroadcast();
    }

    function _assertVerifierDependencies() internal view {
        // BlockProver and ChainInfo are CC3 host precompiles. Foundry's local
        // revm simulation cannot execute those host calls (the CC3 node can),
        // so `pnpm preflight:deployment` must perform the live ChainInfo and
        // committed-fixture BlockProver probes immediately before broadcast.
        // This script still pins and exercises the ordinary decoder contract,
        // and passes the precompile address into the adapter constructor.
        if (DECODER.code.length == 0) revert MissingDependency(DECODER);
        bytes32 actualCodeHash;
        assembly {
            actualCodeHash := extcodehash(DECODER)
        }
        if (actualCodeHash != DECODER_CODE_HASH) {
            revert DependencyCodeHashMismatch(DECODER_CODE_HASH, actualCodeHash);
        }
        string memory fixture = vm.readFile("../worker/fixtures/historical-proof.json");
        bytes memory fixtureTransaction = vm.parseJsonBytes(fixture, ".proof.txBytes");
        (bool ok, bytes memory data) = DECODER.staticcall(
            abi.encodeWithSignature("getTransactionType(bytes)", fixtureTransaction)
        );
        if (!ok || data.length != 32 || abi.decode(data, (uint8)) != 2) {
            revert DependencyReadFailed(DECODER);
        }
    }

    /// @dev Foundry's JSON type parser accepts tuple arrays but not objects.
    /// The committed SDK fixture is therefore read field-by-field, preserving
    /// the exact proof tuple while failing closed if a required field is absent.
    function _fixtureProof(string memory fixture)
        internal
        pure
        returns (
            uint64 chainKey,
            uint64 height,
            bytes memory encodedTransaction,
            MerkleProof memory merkleProof,
            ContinuityProof memory continuityProof
        )
    {
        chainKey = _asUint64("fixture.chainKey", vm.parseJsonUint(fixture, ".proof.chainKey"));
        height = _asUint64("fixture.headerNumber", vm.parseJsonUint(fixture, ".proof.headerNumber"));
        encodedTransaction = vm.parseJsonBytes(fixture, ".proof.txBytes");
        if (encodedTransaction.length == 0) revert DependencyReadFailed(BLOCK_PROVER);

        MerkleProofEntry[] memory siblings = new MerkleProofEntry[](FIXTURE_SIBLING_COUNT);
        for (uint256 i; i < FIXTURE_SIBLING_COUNT; ++i) {
            string memory prefix =
                string.concat(".proof.merkleProof.siblings[", vm.toString(i), "]");
            siblings[i] = MerkleProofEntry({
                hash: vm.parseJsonBytes32(fixture, string.concat(prefix, ".hash")),
                isLeft: vm.parseJsonBool(fixture, string.concat(prefix, ".isLeft"))
            });
        }
        merkleProof = MerkleProof({
            root: vm.parseJsonBytes32(fixture, ".proof.merkleProof.root"), siblings: siblings
        });
        continuityProof = ContinuityProof({
            lowerEndpointDigest: vm.parseJsonBytes32(
                fixture, ".proof.continuityProof.lowerEndpointDigest"
            ),
            roots: vm.parseJsonBytes32Array(fixture, ".proof.continuityProof.roots")
        });
    }

    function _product() internal view returns (Product memory) {
        return Product({
            chainKey: CHAIN_KEY,
            aggregator: SOURCE_AGGREGATOR,
            feedDecimals: 8,
            triggerBelow: _asPositiveInt256("DEMO_TRIGGER_BELOW", vm.envUint("DEMO_TRIGGER_BELOW")),
            activationDelay: _asUint64(
                "DEMO_ACTIVATION_DELAY", vm.envUint("DEMO_ACTIVATION_DELAY")
            ),
            policyDuration: _asUint64("DEMO_POLICY_DURATION", vm.envUint("DEMO_POLICY_DURATION")),
            claimGracePeriod: _asUint64(
                "DEMO_CLAIM_GRACE_PERIOD", vm.envUint("DEMO_CLAIM_GRACE_PERIOD")
            ),
            minBreachDuration: _asUint64(
                "DEMO_MIN_BREACH_DURATION", vm.envUint("DEMO_MIN_BREACH_DURATION")
            ),
            premiumBps: _asUint32("DEMO_PREMIUM_BPS", vm.envUint("DEMO_PREMIUM_BPS")),
            maxCoveragePerPolicy: vm.envUint("DEMO_MAX_COVERAGE"),
            enabled: true
        });
    }

    function _asUint64(string memory field, uint256 value) internal pure returns (uint64) {
        if (value > type(uint64).max) revert ValueDoesNotFitUint64(field, value);
        uint64 result;
        assembly {
            result := value
        }
        return result;
    }

    function _asUint32(string memory field, uint256 value) internal pure returns (uint32) {
        if (value > type(uint32).max) revert ValueDoesNotFitUint32(field, value);
        uint32 result;
        assembly {
            result := value
        }
        return result;
    }

    function _asPositiveInt256(string memory field, uint256 value) internal pure returns (int256) {
        if (value == 0 || value > uint256(type(int256).max)) {
            revert ValueDoesNotFitInt256(field, value);
        }
        int256 result;
        assembly {
            result := value
        }
        return result;
    }
}
