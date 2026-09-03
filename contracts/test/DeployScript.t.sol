// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import {
    MerkleProof,
    MerkleProofEntry,
    ContinuityProof
} from "../src/AttestcoinVerifierAdapter.sol";

/// @dev Keeps the deployment script's fixture parser exercised in CI without
/// broadcasting or depending on a funded CC3 account.
contract DeployScriptFixtureTest is Test {
    function test_parseFixtureProofTuple() public view {
        string memory fixture = vm.readFile("../worker/fixtures/historical-proof.json");
        uint64 chainKey = uint64(vm.parseJsonUint(fixture, ".proof.chainKey"));
        uint64 height = uint64(vm.parseJsonUint(fixture, ".proof.headerNumber"));
        bytes memory txBytes = vm.parseJsonBytes(fixture, ".proof.txBytes");
        bytes32 root = vm.parseJsonBytes32(fixture, ".proof.merkleProof.root");
        MerkleProofEntry[] memory entries = new MerkleProofEntry[](9);
        for (uint256 i; i < entries.length; ++i) {
            string memory prefix =
                string.concat(".proof.merkleProof.siblings[", vm.toString(i), "]");
            entries[i] = MerkleProofEntry({
                hash: vm.parseJsonBytes32(fixture, string.concat(prefix, ".hash")),
                isLeft: vm.parseJsonBool(fixture, string.concat(prefix, ".isLeft"))
            });
        }
        MerkleProof memory merkleProof = MerkleProof({ root: root, siblings: entries });
        ContinuityProof memory continuityProof = ContinuityProof({
            lowerEndpointDigest: vm.parseJsonBytes32(
                fixture, ".proof.continuityProof.lowerEndpointDigest"
            ),
            roots: vm.parseJsonBytes32Array(fixture, ".proof.continuityProof.roots")
        });
        assertEq(chainKey, 3);
        assertGt(height, 0);
        assertGt(txBytes.length, 0);
        assertEq(merkleProof.siblings.length, 9);
        assertEq(continuityProof.roots.length, 6);
    }
}
