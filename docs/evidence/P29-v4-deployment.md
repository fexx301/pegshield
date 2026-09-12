# P29 — v4 deployment, CC3 gas-estimation incident, and manual recovery

Status: **SETTLED — v4 policy 1 claimed atomically on 2026-09-12**

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

## Pre-claim dry run: shared-anchor batch proofs rejected for distant blocks

Before the live claim, the full preparation pipeline (receipts → prover batch
→ artifact integrity → adapter `verifySourceLog`) was dry-run end-to-end
against historical rounds 1185/1186. The dry run caught a deterministic
proof-construction failure:

- Requesting one `proof-batch-by-tx` for **both** transactions (the
  web claim service's "nearby events" path) returned a single shared
  continuity anchor (371 roots). The earlier round's proof verified, but the
  **later round's proof was rejected by the live BlockProver with "Merkle
  root mismatch"** — reproducible across four retries, so not node flake.
- Requesting **one single-item batch per transaction** gave each proof its
  own anchored continuity path (71 and 76 roots respectively), and both
  verified through the deployed v4 adapter's compiled `verifySourceLog`.

This is the same behavior the deployed web claim service encodes as its
distance rule, now confirmed empirically at the protocol level: a shared
batch continuity path is not valid for arbitrary block distances, only for
nearby headers. The claim pipeline therefore builds each proof from its own
single-item batch, verifies both through the adapter before submission, and
refuses to proceed if either fails.

The dry run also hardened two smaller construction details: the watcher's
pairing logic now scans all round pairs (not just the first two, which could
miss a valid later pair when the first two land within the 300-second
interval), and artifact construction rounds the observed answer to the
nearest integer before comparing it to the indexed topic (a raw float
conversion can be non-integral and throw).

## Settlement (2026-09-12 08:15 UTC)

The watcher detected the qualifying pair one day after deployment:

- Round 1187: answer `0.99986193`, updated 1789196435 (07:47:15 UTC), block
  25959697, transaction
  `0x622e76dad1762307848c53d5554e2f54526107b3a4df486e4ea9441e8adfe02d`
- Round 1188: answer `0.99986417`, updated 1789200035 (08:40:35 UTC), block
  25959995, transaction
  `0x6601d8b8013f791c7f73a19105b4ac3308d11ce05348cd80c6d5742c403a61b0`
- Interval: exactly 3,600 seconds (product minimum is 300)

The claim pipeline prepared per-transaction single-item batch proofs, verified
both through the deployed v4 adapter's compiled `verifySourceLog` (448-byte
authenticated `VerifiedSourceLog` each), simulated the full
`submitClaim` calldata via `eth_call` (no revert), and submitted with an
explicit 2,000,000 gas limit as the permissionless relayer.

Receipt `0x575030ff19daffcbbc004f66fdf00cd1489341b3de80bcc424c5a32acc2120c8`
(block 5,473,478, 616,966 gas, four events: `BreachObserved`,
`ConfirmationObserved`, `PolicyPaid`, ERC-20 `Transfer`):

- Policy 1 state: `Active` → `Claimed`; `firstRoundId` 1187; `firstBreachAt`
  1789196435; `firstEventId`
  `0xac4afec2eb57d135722bfb20399abb117add00339c38fc7ccba012fcc307a1d2`
- Payout: exactly 100 TestUSD to the beneficiary locked at purchase
  (`0x3dFF45B4…334c`), whose token balance moved from 997.5M (mint 1,000M
  minus 2.5M premium) to 1,097.5M — an exact 100M credit
- Pool accounting: reserved capital 1,000,000,000 → 0; accounted capital
  1,002,500,000 → 902,500,000

This is the second complete end-to-end atomic settlement on CC3 (after the v3
settlement of 2026-09-04, P28) and the first same-day
purchase-to-payout cycle: policy purchased 08:01 UTC, claimed 08:15 UTC.
