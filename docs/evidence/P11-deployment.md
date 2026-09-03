# P11 — Deployment scripts and schema

Status: **DEPLOYED / manifest verified**

## Implemented

- `contracts/script/Deploy.s.sol` refuses non-CC3 chain IDs, missing native
  balances, mismatched operator addresses, a missing decoder, and a decoder
  code-hash/type mismatch before broadcasting. CC3's BlockProver and ChainInfo
  are host precompiles that Foundry's local revm cannot execute; the mandatory
  `pnpm preflight:deployment` command performs those live reads and the exact
  committed-fixture BlockProver verification immediately before broadcasting.
- The script deploys TestUSD, the real adapter, and the pool in order, grants
  only the explicitly configured demo minter, mints demo balances, funds the
  pool, creates one product, and purchases one policy using separate operator
  keys.
- `docs/schemas/deployment.schema.json` enforces CC3 chain 102031, exact
  compiler/EVM settings (`solc 0.8.28`, optimizer 200, London), address/hash
  formats, positive timing/capital fields, and `demoOnly: true`.
- `scripts/preflight-deployment.mjs` performs a read-only CC3 and Ethereum
  dependency/code-hash check, verifies the real committed proof through
  BlockProver, probes the decoder, and reports whether the live manifest exists.
- `DeployScriptFixtureTest` exercises the deployment script's field-by-field
  parser for the committed proof object and confirms the expected Merkle and
  continuity proof lengths without broadcasting.
- `scripts/generate-deployment-manifest.mjs` consumes Foundry broadcast
  receipts only after a clean commit, reads live roles/product/policy state,
  hashes deployed runtime code and the pinned source aggregator on Ethereum,
  and writes the public deployment manifest without keys. It can also accept
  explicitly supplied `--product-tx-hash` and `--policy-tx-hash` values when a
  partial Foundry run was recovered manually; each override is fetched and
  receipt-status-checked against CC3 before inclusion.
- `scripts/derive-demo-trigger.mjs` reads the current signed Ethereum feed
  answer and emits a visible, margin-based `DEMO_TRIGGER_BELOW` value; it does
  not mutate configuration or chain state.

Read-only run at 2026-09-01T19:14:00Z with `--margin-bps 100` observed answer
`99989777` and emitted `DEMO_TRIGGER_BELOW=100989675` (`$1.00989675`). This is
deliberately permissive testnet configuration and must be recomputed before a
future deployment.

No private key is committed. The authorized CC3 broadcast deployed TestUSD,
the verifier adapter, and PegShieldPool, then funded the pool, created product
1, and purchased demo policy 1. The first gas-tight fund call reverted without
state change; its higher-limit recovery receipt is the canonical funding
receipt. The preflight passed against the public CC3 RPC, including
`blockProverFixtureVerified: true` and decoder type `2`. The public
[`deployments/cc3-testnet.json`](../../deployments/cc3-testnet.json) was
generated from the verified receipts and passes its JSON schema.
