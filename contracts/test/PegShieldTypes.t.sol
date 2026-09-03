// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import {
    OracleObservation,
    Policy,
    PolicyState,
    Product,
    VerifiedSourceLog
} from "../src/PegShieldTypes.sol";

contract PegShieldTypesTest is Test {
    function test_productBoundaryTypes() public pure {
        Product memory product = Product({
            chainKey: 3,
            aggregator: address(0x1234),
            feedDecimals: 8,
            triggerBelow: 99_000_000,
            activationDelay: 1 hours,
            policyDuration: 7 days,
            claimGracePeriod: 2 days,
            minBreachDuration: 1 hours,
            premiumBps: 250,
            maxCoveragePerPolicy: 1_000e6,
            enabled: true
        });

        assertEq(product.chainKey, 3);
        assertEq(product.aggregator, address(0x1234));
        assertEq(product.feedDecimals, 8);
        assertEq(product.triggerBelow, 99_000_000);
        assertEq(product.activationDelay, 1 hours);
        assertEq(product.policyDuration, 7 days);
        assertEq(product.claimGracePeriod, 2 days);
        assertEq(product.minBreachDuration, 1 hours);
        assertEq(product.premiumBps, 250);
        assertEq(product.maxCoveragePerPolicy, 1_000e6);
        assertTrue(product.enabled);
    }

    function test_policyAndObservationTypes() public pure {
        Policy memory policy = Policy({
            productId: 1,
            holder: address(0x1111),
            beneficiary: address(0x2222),
            coverage: 100e6,
            premium: 3e6,
            purchasedAt: 100,
            startsAt: 110,
            endsAt: 210,
            firstBreachAt: 150,
            firstRoundId: 42,
            firstEventId: keccak256("first"),
            state: PolicyState.BreachObserved
        });
        VerifiedSourceLog memory source = VerifiedSourceLog({
            chainKey: 3,
            attestedTransactionDigest: keccak256("tx"),
            receiptLogPosition: 2,
            emitter: address(0x3333),
            topics: new bytes32[](3),
            data: hex"00",
            receiptSucceeded: true
        });
        OracleObservation memory observation = OracleObservation({
            eventId: keccak256("event"), answer: -1, roundId: 43, updatedAt: 160
        });

        assertEq(uint8(policy.state), uint8(PolicyState.BreachObserved));
        assertEq(source.topics.length, 3);
        assertTrue(source.receiptSucceeded);
        assertEq(observation.answer, -1);
        assertEq(observation.roundId, 43);
    }
}
