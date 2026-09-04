# P27 — Atomic-claim hardening and v3 deployment

Status: **DEPLOYED — atomic claim code and setup verified; fresh live settlement pending**

Fable's independent plan review identified a permissionless-relay griefing
case in the original two-transaction state machine: a relayer could record a
late first observation and leave no in-window event capable of confirming it.
The v3 pool removes that intermediate write. `submitClaim` authenticates both
source receipts, requires a distinct later round and timestamp, enforces the
minimum interval, and pays in one transaction. A failed or maliciously ordered
pair leaves the policy `Active` and changes no accounting.

The Foundry suite contains the explicit regression:
`test_adversaryCannotPinLateFirstObservation`. It first submits the hostile
late-first ordering, confirms the revert and unchanged state, then settles the
same policy with a legitimate pair. The complete repository check passes with
58 Foundry tests, 21 worker tests, four web tests, production builds, ABI drift
checks, schemas, formatting, lint, and type checking.

Additional boundaries introduced with v3:

- product activation delay must be at least 300 seconds;
- product premium must be strictly below 100% (`MAX_PREMIUM_BPS = 9,999`);
- worker and browser calldata expose only the atomic
  `submitClaim(uint256,bytes,uint256,bytes,uint256)` write.

## Live CC3 deployment

- TestUSD: `0xA82e7ED8a10DA85d64E3C41D0fFbE5B95E1B30F9`;
- adapter: `0x9E1d5Aec273802bDe517Bb55B3DEc10b09E71DbF`;
- pool: `0x9BE0af5Ad671E1dBb2E9C421f19479C04CF3b27b`;
- policy 1 purchase:
  `0x70e7184d8c7479960827a2f5056e8624a7b95fc49ba0e69af6597d3a588fd7fe`.

Read-only state reconciliation returned `1,002,500,000` accounted TestUSD,
`100,000,000` reserved TestUSD, policy 1 `Active`, activation delay `300`, and
maximum premium BPS `9,999`. The validated public record is
`deployments/cc3-testnet-v3.json`.

## Proof lifetime observation

At `2026-09-04T05:26:31Z`, the deployment preflight re-executed the committed
proof generated at `2026-09-01T16:29:54Z`. CC3 BlockProver still returned true
after approximately 61 hours while the decoder and Ethereum aggregator code
hashes remained pinned. This exceeds the review's requested 24-hour check. It
is evidence of current testnet behavior, not a guarantee that every future
proof-verifier deployment has unlimited retention.

The remaining v3 protocol gate is one fresh post-activation pair and the live
atomic payout. The earlier v2 two-stage payouts remain valid historical
integration evidence but are not presented as proof of the v3 regression fix.
