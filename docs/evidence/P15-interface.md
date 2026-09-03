# P15 — Functional web interface

Status: **PASS — CC3-backed testnet dashboard and live wallet rehearsal complete**

## Delivered route

`/` now presents an evidence-first PegShield dashboard with a split hero,
CC3/testnet wallet gate, pool summary, fixed demo product terms, coverage and
beneficiary form, policy lifecycle timeline, source-proof evidence panel,
architecture boundaries, and explicit trust/non-trust statements.

The purchase form reads the pool’s payout token, exact `quotePremium`, wallet
balance, and allowance. It requests an exact-premium ERC-20 approval when
needed, then uses Wagmi’s `useSimulateContract` path for `buyPolicy` before the
user’s wallet can submit the purchase. Receipts refresh the live policy
selection. The wallet button uses Wagmi’s injected connector and offers a
wrong-network switch to CC3. No private configuration is bundled; pool reads
activate only when the deployment address is supplied. The selected-policy read
honors the shareable `?policy=<id>` query, defaulting to the latest live policy.

The claim surface accepts only a bounded normalized worker artifact. It checks
the pinned Ethereum emitter/topic, receipt status, proof SDK/chain, shape, and
canonical SHA-256 before encoding the proof. CC3 simulation and gas estimation
must pass before a wallet-gated `submitBreachProof` or
`submitConfirmationProof` write is enabled, with 120% gas headroom.

## Verification

```text
pnpm --filter @pegshield/web typecheck
pnpm --filter @pegshield/web test
pnpm --filter @pegshield/web build
```

All commands pass. The clean browser smoke test reads the deployed pool, selects
policy 1, preserves its terminal state after reload, and sees the purchase and
prepared-proof controls. P24 records the exact-premium approval and purchase of
policy 2. P25 records fresh-proof selection, browser validation, successful CC3
simulations, user-approved breach/confirmation receipts, and the exact payout
with policy 2 refreshed to `Claimed`.
