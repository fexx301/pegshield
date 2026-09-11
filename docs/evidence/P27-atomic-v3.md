# P27 — Atomic-claim hardening and v3 deployment

Status: **PASS — atomic v3 claim and exact live payout confirmed**

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

Note: the state figures above and the `demoPolicy.state` recorded in the
manifest are deployment-time snapshots taken before the policy-1 settlement.
Live status is the settlement receipt linked from the README and
`P28-live-atomic-settlement.md`; these records are kept as-is as deployment
evidence.

## Fresh v3 observation and backup policies

Policy 1 activated at Ethereum-time-compatible timestamp `1788504450`. The
first subsequent qualifying source event is Ethereum USDC/USD round `1171`,
answer `99985000` (8 decimals), timestamp `1788505259`, in block `25902321`:

- source transaction:
  `0x4876a2e3b835394a51fcab498775821df3c29e817481a890cba24a10a7ae9e32`;
- receipt log position: `2`;
- normalized proof digest:
  `sha256:682abb9104dfbae961d79e75ce152469d8a9633c95ed8d2adf28f739a826478c`.

The proof service initially reported attested height `25902320`, correctly
refusing to prove the next block. After its head advanced to `25902330`, the
same request succeeded. This demonstrates that the worker waits for actual
Attestcoin finality instead of treating an Ethereum RPC receipt as sufficient.

Five further policies were purchased from the dedicated demo wallet, making
policies 1–6 available for settlement and rehearsals. The policy 2 purchase is
transaction
`0x38b018a44182c21db18a7840cbbc7d2844da5484dab1a82d040d021a0c0845f2`;
the four subsequent backup purchases are:

- `0xcfcc7db513b5c8b4881777fbfbc6cdc206de0e3563fa57e7457a9657142f8ec3`;
- `0x24385bf659c947cd7c63d6403254c58f98ca677dda728b169e1f598f4bec3064`;
- `0x6a5a5650193f20a7a356bbb1db9d67de73cc435ed450f9dd31ed6a2a17eed28a`;
- `0x866c4a534814aad183710421e2df72e6b2fc53f59e8d636135f9faea89ca0e20`.

After confirmation, live state returned `nextPolicyId = 7`, reserved capital
`600,000,000`, and accounted capital `1,015,000,000` in six-decimal TestUSD
units. GitHub Actions run `33847108525` passed the contracts,
schema/secret-scan, TypeScript, production-build, and local-browser E2E jobs
for commit `107f3b1`.

## Proof lifetime observation

At `2026-09-04T05:26:31Z`, the deployment preflight re-executed the committed
proof generated at `2026-09-01T16:29:54Z`. CC3 BlockProver still returned true
after approximately 61 hours while the decoder and Ethereum aggregator code
hashes remained pinned. This exceeds the review's requested 24-hour check. It
is evidence of that checkpointed fixture's behavior, not a guarantee that
every proof has unlimited retention.

The live v3 run confirmed that warning: round 1171's single-proof continuity
path was rejected after the attestation window advanced, even though its
authenticated transaction and Merkle data remained unchanged. A fresh batch
request for rounds 1171–1172 produced a current continuity path and restored
round 1171 verification. Round 1172's independently generated proof also
verified. Operational rule: refresh both proofs immediately before a claim;
do not assume an earlier cached continuity path remains accepted.

The final atomic settlement receipt is documented in
`P28-live-atomic-settlement.md`. The earlier v2 two-stage payouts remain valid
historical integration evidence but are not presented as proof of the v3
regression fix.
