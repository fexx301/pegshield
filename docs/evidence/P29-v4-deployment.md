# P29 — v4 deployment, CC3 gas-estimation incident, and manual recovery

Status: **DEPLOYED — policy 1 active, awaiting qualifying observations**

## Why a v4 deployment

The v3 deployment settled policy 1 atomically on 2026-09-04 (see
`P28-live-atomic-settlement.md`). Its five backup policies (2–6) reached their
claim deadline (`endsAt` 1789111080/1789111155 + 21,600s grace = 2026-09-11
13:18 UTC) unclaimed and are now permanently unclaimable. A fresh product and
policy were needed to produce current-dated settlement evidence for the
BUIDL CTC 2026 Fall submission (deadline 2026-09-14 04:59 UTC).

## v4 contracts (CC3 testnet, chain 102031)

- TestUSD: `0xf79caedff7a2e4349f1a86fa39da151151d8afc8`
- AttestcoinVerifierAdapter: `0x07a87e5a533c0d39eb716dc38afd32b8701c2dd9`
- PegShieldPool: `0x53712c0cd4edfce30331a7aeac933086ab47c711`
- Product 1: trigger `100983312` (derived 2026-09-11 from round 1186 answer
  `0.99983477` + 100 bps via `pnpm demo:trigger -- --margin-bps 100`),
  activation delay 300, duration 604,800, grace 21,600, min breach 300,
  premium 250 bps, max coverage 500,000,000
- Policy 1: purchased by the demo policyholder; coverage 100 TestUSD, premium
  2.5 TestUSD; `startsAt` 1789139985, `endsAt` 1789744785
- Pool state after purchase: accounted 1,002,500,000; reserved 100,000,000

Validated manifest: `deployments/cc3-testnet-v4.json` (schema-valid; the
generator verified live roles, product, policy, and runtime code hashes).

## Incident: CC3 `eth_estimateGas` instability (out-of-gas broadcast)

The `forge script --broadcast --slow` run deployed all three contracts and
both mints successfully, then **transaction 6 (`fundPool`) reverted**:

- Transaction `0xa8dc0fd0e021a090c06fc9a54e22248546ad4c1ead5649bc79df934d48faf0a9`
- Gas limit 110,352 (`0x1b110`) — **exactly equal to gas used**: out of gas.
- The underwriter held the full 1,000,000,000 TestUSD and an unlimited
  allowance at the time, so the transfer itself was sound.
- A fresh `eth_estimateGas` for the identical call returned **226,245** —
  more than double the value forge used at broadcast time.

This also retroactively explains an earlier failure the same day: the worker
CLI's `proof simulate` for v3 policy 2 (13:03 UTC) died in its
gas-estimation path while both proof artifacts were independently proven
valid through the deployed v3 adapter's `verifySourceLog` (448-byte
authenticated `VerifiedSourceLog` each). Operational conclusion:

> **CC3 `eth_estimateGas` is intermittently unstable (observed returning
> ~50% of actual need). Never broadcast with unmultiplied estimates on CC3 —
> send explicit gas limits (`cast --gas-limit`, or `forge -g <multiplier>`).**

A follow-up attempt with `forge script --resume` failed differently: forge
re-sent the identical reverted transaction ("already known") instead of
replaying past it, then aborted on a nonce check (`Expected 15 got 16`).

## Recovery (the documented manual path)

The remaining setup calls were completed with `cast send` and explicit gas
limits, exactly as the README's deployment notes anticipate for RPC
interruptions:

| Step                                    | Transaction                                                          | Gas                     |
| --------------------------------------- | -------------------------------------------------------------------- | ----------------------- |
| `fundPool(1000000000)`                  | `0x35336ae89c101423d38e6a2af1c6f08a70b1aed6504d75221ae1d68dbf60d869` | 226,292 (limit 500,000) |
| `createProduct(...)`                    | `0xca336649b66f5823789f4741283fa4c82624a25110a38416e5746261f358fe3b` | 191,848 (limit 500,000) |
| policyholder `approve`                  | `0x8826229cf4b5c24cb07a202007e1c3cfd0d49b7f552447520295e988d5796a40` | explicit                |
| `buyPolicy(1, 100000000, policyholder)` | `0x39359aab37bc067b62bd224dde98f05407bf72dbb90e19053a72dfe0ce0512f2` | 250,962 (limit 500,000) |

The manifest generator accepted the explicit `--product-tx-hash` and
`--policy-tx-hash` overrides and validated them against live receipts.

## Claim plan

A watcher polls the pinned Ethereum USDC/USD aggregator for rounds with
`updatedAt >= 1789139985` and `answer < 100983312`. Round 1186
(07:56 UTC) predates the window, so the claim requires rounds 1187 and a
later confirmation at least 300 seconds apart. Feed cadence is irregular
(observed 1h–23h between rounds); the settlement will be documented here and
in the README once submitted with an explicit gas limit by the permissionless
relayer.
