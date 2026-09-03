# P09 — Expiry, invariants, security, and gas gate

Status: **PARTIAL — offline gates passing; CC3 gas measurement pending**

## Implemented checks

- `expirePolicy` is permissionless, strict after `endsAt + claimGracePeriod`,
  releases reserve from both active and breach-observed policies, leaves
  accounted capital unchanged, and cannot transition claimed or already expired
  policies.
- Pause is intentionally omitted. There is no admin path that can block proof
  submission, payout, expiry, or reads.
- Foundry invariant handler exercises funding, purchases, withdrawals, and
  expiry while asserting `reservedCapital <= accountedCapital` and
  `accountedCapital <= payoutToken.balanceOf(pool)`.
- A callbacking ERC20 test proves payout reentrancy is rejected by the pool's
  `ReentrancyGuard`.

## Executed checks

```text
forge test --root contracts -vvv
62 passed; 0 failed; 0 skipped

forge test --root contracts --match-path 'test/PegShieldPool.invariants.t.sol' -vvv
2 invariant properties passed; 256 runs; 128,000 calls per property

forge build --root contracts --sizes
PegShieldPool runtime: 11,448 bytes
AttestcoinVerifierAdapter runtime: 3,992 bytes
TestUSD runtime: 2,911 bytes
```

The current local gas report records `submitBreachProof` at 465,464 gas,
`submitConfirmationProof` at 727,480 gas, and the synthetic adapter fixture
path at 128,976 gas. These include test mocks and are not substituted for the
live CC3 decoder measurement.

The final CC3 gas ceiling and 20% headroom cannot be claimed until a deployed
adapter and live proof path exist. P11/P12 must record those measurements.
