# P05 — Pool accounting and product registry

Status: PASS

## Locked behavior implemented

- `PegShieldPool` pins the payout token and verifier adapter as immutable
  constructor values and grants `DEFAULT_ADMIN_ROLE` plus
  `UNDERWRITER_ROLE` only to the explicit underwriter.
- `fundPool` transfers first, checks the pool balance delta exactly equals the
  requested amount, and only then increases `accountedCapital`.
- `withdrawFreeCapital` checks available capital, updates accounting before the
  token transfer, and can never consume reserved capital.
- Direct token donations remain outside accounting.
- Products have sequential IDs, validated immutable terms, and a one-way
  underwriter disable operation. Unknown products and policies revert.

## Executed checks

```text
forge fmt --root contracts
forge test --root contracts --match-path 'test/PegShieldPool.accounting.t.sol' -vvv
  12 passed; 0 failed
```

The tests cover constructor boundaries, role failures, third-party funding,
zero amounts, exact transfer accounting, fee-on-transfer rejection, free-only
withdrawal, raw donations, every product validation boundary, sequential IDs,
permanent disablement, and unknown reads. Claim/purchase state transitions are
intentionally not yet enabled; `reservedCapital` therefore remains zero until
P06 adds policy purchase.

Next allowed packet: **P06 — premium quote and policy purchase**.
