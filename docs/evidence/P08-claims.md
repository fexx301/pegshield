# P08 — Observation state machine and payout

Status: **PASS offline / live policy pending**

## Locked behavior implemented

- First proofs are accepted only for active policies, within the submission
  grace deadline, with a successful receipt, matching chain and emitter, the
  exact Chainlink event shape, a positive answer strictly below the product
  threshold, and a source timestamp inside the purchased coverage window.
- Confirmation requires a later event ID, strictly increasing round and source
  timestamp, and the configured minimum breach duration.
- Event IDs are consumed per policy, allowing the same valid source event to
  support separate policies while preventing replay within one policy.
- Payout effects happen before the token transfer: state becomes `Claimed`, the
  event is consumed, and both reserve and accounted capital decrease before the
  immutable beneficiary receives exactly the policy coverage.
- Submission and payout functions are non-reentrant; callers never influence
  the beneficiary or payout amount.

## Executed checks

```text
forge test --root contracts --match-path 'test/PegShieldPool.claims.t.sol' -vvv
12 passed; 0 failed

forge test --root contracts --match-path 'test/PegShieldPool.reentrancy.t.sol' -vvv
1 passed; 0 failed
```

The claims suite covers valid first/confirmation paths, immutable beneficiary
payout, cross-policy reuse, chronology boundaries, grace closure, wrong chain,
emitter, topic, receipt position and status, zero/negative/equal/above-threshold
answers, event ordering, duplicate state, and repeated payout. The reentrancy
test uses a callbacking ERC20 and proves the callback is rejected while the
single payout completes.

The tests use a pool-boundary verifier mock. The deployed adapter-to-CC3 path
and a fresh post-purchase policy remain P12/P13 work.
