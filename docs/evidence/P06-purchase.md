# P06 — Premium quote and policy purchase

Status: PASS

## Locked behavior implemented

- Premiums use OpenZeppelin `Math.mulDiv(..., Math.Rounding.Ceil)` at the
  product's basis-point rate.
- A purchase requires an enabled product, nonzero beneficiary and coverage,
  and coverage at or below the product maximum.
- The affordability check uses `accountedCapital + premium - reservedCapital`,
  so the newly collected premium becomes backing atomically.
- Premium transfer is exact-delta checked before accounting and policy state
  writes. Fee-on-transfer tokens are rejected.
- Policy terms capture the buyer, immutable beneficiary, coverage, premium,
  and checked `uint64` purchase/start/end timestamps. No cancellation,
  transfer, refund, or term editing exists.

## Executed checks

```text
forge fmt --root contracts
forge test --root contracts --match-path 'test/PegShieldPool.purchase.t.sol' -vvv
  10 passed; 0 failed (including 256 fuzz runs)
```

Coverage includes exact rounding, premium collection, different beneficiary,
premium-backed second purchase, unknown/disabled products, zero boundaries,
maximum coverage, insufficient post-premium capital, fee-on-transfer rejection,
and the `reservedCapital <= accountedCapital` invariant.

Next allowed packet: **P07 — real Attestcoin verifier adapter**.
