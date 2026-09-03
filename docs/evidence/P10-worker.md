# P10 — Typed worker core

Status: **PASS for worker core and live command wiring / live CC3 execution pending**

## Implemented

- Typed proof, Merkle, continuity, and normalized artifact models use `bigint`
  at the ABI boundary and decimal strings in JSON.
- `proofEncoder.ts` is the single worker-side definition of the exact adapter
  tuple and provides deterministic encode/decode round-trips.
- Artifact integrity checks reproduce the committed canonical SHA-256 and
  reject mutations before encoding.
- Configuration and discovery-lock readers fail closed on chain/address/hash
  mismatches; no wallet key is required for read-only commands.
- The CLI supports `config validate`, `proof build`, `proof inspect`,
  `proof encode`, exact-emitter `events scan`, and live `proof simulate` /
  `proof submit` commands with one final JSON object on stdout and
  human-readable errors on stderr. Simulation checks the configured CC3 pool
  runtime against the deployment manifest; submission requires a local
  `RELAYER_PRIVATE_KEY`, simulates first, and never retries a wallet
  transaction.

## Executed checks

```text
pnpm --filter @pegshield/worker typecheck
pnpm --filter @pegshield/worker test
21 passed; 0 failed
pnpm --filter @pegshield/worker build
node worker/dist/cli.js config validate
ETHEREUM_RPC_URL=https://ethereum-rpc.publicnode.com node worker/dist/cli.js proof build --tx 0x60f65e8b0b14daf28495f367ed8f46ade4ebabec4e4b13c86a3f55a7b2f34245 --receipt-log-position 2 --out /tmp/proof.json
node worker/dist/cli.js proof inspect --file worker/fixtures/historical-proof.json
node worker/dist/cli.js proof encode --file worker/fixtures/historical-proof.json --out /tmp/pegshield-proof.hex
ETHEREUM_RPC_URL=https://eth.drpc.org node worker/dist/cli.js events scan --from-block 25881095 --to-block 25881095 --trigger-below 100989675
```

The committed fixture produces a stable adapter-proof digest
`0x7a148a89561d119eff3fb2c402ca44a9fb0bdddae5ccf4f7e6bcd1a4d87ececb`.
No private key is required or printed for read-only commands. The live
simulation/submit path is implemented but cannot be executed until a funded
deployment manifest and a relayer account exist.

The live build command was also run against the public Ethereum and Attestcoin
endpoints. It produced a schema-valid fresh artifact and the same adapter
encoding digest (`0x7a148a89561d119eff3fb2c402ca44a9fb0bdddae5ccf4f7e6bcd1a4d87ececb`)
as the committed fixture. The generated-at timestamp is intentionally not
used as an identity field.

The live scanner run returned the pinned emitter, block-global log index `516`,
receipt position `2`, signed answer `99989777`, round `1166`, and source time
`1788249611`. The default Publicnode endpoint currently rejects archive
`eth_getLogs` without a token, so the command was verified with the
archive-capable public `eth.drpc.org` endpoint; operators should set their own
Ethereum RPC in `.env` for production rehearsal.

After P12 creates the manifest, the exact live commands are:

```text
node worker/dist/cli.js proof simulate --policy 1 --stage breach --file proofs/<event>.json
node worker/dist/cli.js proof submit --policy 1 --stage breach --file proofs/<event>.json
```
