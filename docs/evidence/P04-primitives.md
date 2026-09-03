# P04 — Contract primitives and demo token

Status: PASS

## Scope

- `PegShieldTypes.sol` defines the locked `Product`, `Policy`, `PolicyState`,
  `VerifiedSourceLog`, and `OracleObservation` boundaries plus shared custom
  errors.
- `TestUSD.sol` is an explicitly testnet-only six-decimal ERC-20 demo token.
  Its deployer receives `DEFAULT_ADMIN_ROLE` and `MINTER_ROLE`; additional
  minters must be granted explicitly through OpenZeppelin access control.
- No verifier, claim, or business-state mock is present in production `src`.

## Executed checks

```text
forge fmt --root contracts
forge test --root contracts --match-path 'test/*Types*' -vvv
  2 passed; 0 failed
forge test --root contracts --match-path 'test/*TestUSD*' -vvv
  4 passed; 0 failed
forge build --root contracts --sizes
  Compiler run successful
```

The compiled `TestUSD` runtime is 2,827 bytes, well below the CC3 contract
size limit. Type-boundary tests cover feed-native signed thresholds, full-width
round IDs, receipt-log metadata, and policy state storage.

Next allowed packet: **P05 — pool accounting and product registry**.
