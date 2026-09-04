# PegShield

PegShield is an evidence-first parametric USDC depeg protection prototype for
Creditcoin CC3 testnet. A permissionless relayer submits two Attestcoin proofs
of Ethereum `AnswerUpdated` receipts in one atomic claim; the CC3 pool checks
their source chronology, threshold, replay status, and reserve accounting
before paying a fixed amount of demo TestUSD to the beneficiary stored at
purchase.

This is a hackathon prototype, not insurance or a production stablecoin.
`TestUSD` is intentionally a six-decimal demo token. Never send production
assets or private keys to this repository.

## User-friendly explanation

PegShield is fixed-payout protection for a USDC depeg on Creditcoin CC3
testnet. An underwriter deposits TestUSD into a visible pool. A user connects
a CC3 wallet, chooses coverage and a beneficiary, pays a one-time premium, and
gets a policy whose terms are locked at purchase.

If the pinned Ethereum USDC/USD aggregator emits two qualifying
below-threshold `AnswerUpdated` events after activation, Attestcoin proves the
exact Ethereum receipts. A permissionless relayer submits both proofs in one
transaction, but the CC3 contract makes the decision: it checks the aggregator,
event topic, receipt success, threshold, chronology, timing, replay status, and
reserve capacity. Once the pair passes, the pool pays the exact coverage to the
beneficiary stored in the policy, marks it `Claimed`, and blocks replay.

In one sentence: **buy fixed coverage, prove the depeg twice, and let CC3 pay
the locked beneficiary without a bridge or a hidden oracle.** The deployed
threshold is an intentionally visible testnet/demo parameter, not a production
insurance recommendation.

## Current status

The offline protocol core is implemented and reproducible:

- Attestcoin/CC3 discovery is locked at chain ID `102031`, with the official
  BlockProver, ChainInfo, EVM-v1 decoder, and a verified Ethereum fixture.
- `AttestcoinVerifierAdapter` calls the official proof boundary and exposes
  only an authenticated receipt log.
- `PegShieldPool` has exact token-delta accounting, immutable product/policy
  terms, atomic two-proof settlement, expiry, replay protection, and
  effects-before-transfer payout ordering. Atomic settlement prevents a
  permissionless relayer from pinning an unusably late first observation.
- 62 Foundry tests pass, including 256-run invariant properties and an ERC20
  callback/reentrancy test. The worker has 21 deterministic tests covering
  artifact integrity, exact event filtering, bounded proof-service behavior,
  and CC3 claim calldata. The web build and local Playwright smoke test pass.
- The CC3 deployment is live on testnet and recorded in the validated
  `deployments/cc3-testnet-v3.json` manifest. The preserved v1/v2 manifests
  remain available as historical deployment evidence.
  Funded credentials remain local and ignored. The web dashboard reads the
  deployed pool when `NEXT_PUBLIC_PEGSHIELD_POOL_ADDRESS` is configured. It
  now exposes wallet-gated exact-premium purchase and verified-proof claim
  controls. Funded-wallet and claim-rehearsal evidence is kept in a separate
  private release packet; this public checkout contains the implementation and
  protocol documentation.

Public technical evidence lives in [`docs/evidence`](docs/evidence). Private
planning, wallet-linked evidence, and release notes are kept outside public
history.

## Live demo and public evidence

PegShield is deployed on Creditcoin CC3 testnet (chain ID `102031`). The public
links below are safe to share with reviewers:

- [Open the live dashboard](https://web-three-zeta-pp0cpatyl9.vercel.app/?policy=2)
- [PegShield v3 pool on CC3](https://creditcoin-testnet.blockscout.com/address/0x9be0af5ad671e1dbb2e9c421f19479c04cf3b27b)
- [TestUSD v3 token on CC3](https://creditcoin-testnet.blockscout.com/address/0xa82e7ed8a10da85d64e3c41d0ffbe5b95e1b30f9)
- [Attestcoin v3 verifier adapter on CC3](https://creditcoin-testnet.blockscout.com/address/0x9e1d5aec273802bde517bb55b3dec10b09e71dbf)
- [V3 policy 1 purchase](https://creditcoin-testnet.blockscout.com/tx/0x70e7184d8c7479960827a2f5056e8624a7b95fc49ba0e69af6597d3a588fd7fe)
- [Prior live breach observation](https://creditcoin-testnet.blockscout.com/tx/0xbf43319f0b2adcc95a1c629bb076f588fb884a19b43fc5342d1ba6d7ac5dbaa4)
- [Prior live confirmation and payout](https://creditcoin-testnet.blockscout.com/tx/0x96039de10e844504a847b8f1c1a99e71e58de03b6dd27284d268e9497054e770)
- [Ethereum source event, round 1169](https://etherscan.io/tx/0xb9f980da1350fbb2350fe6b6bdbc3fba3717c556662e3b6b275b495f84ca6eb0)
- [Ethereum source event, round 1170](https://etherscan.io/tx/0x5adcdf88fe55221c6e23d1aad108bf1e75120b0165792a0ed12146159a95cb43)

Attestcoin is the trust boundary: the relayer supplies a proof of the exact
Ethereum receipt, the CC3 verifier authenticates it, and the adapter exposes
only the locked `AnswerUpdated` event to the pool. The public dashboard shows
the terminal demo policy and its evidence; all contract writes remain wallet-
gated and testnet-only.

## Architecture

```text
Ethereum USDC/USD aggregator receipt
        │
        ▼
Attestcoin proof service → CC3 BlockProver + EVM-v1 decoder
        │  authenticated receipt log
        ▼
AttestcoinVerifierAdapter (opaque proof bytes in, verified log out)
        │
        ▼
PegShieldPool (terms, timing, threshold, replay, reserve, payout)
        │
        ▼
Immutable beneficiary receives exact TestUSD coverage
```

The adapter stores an authenticated transaction-envelope digest. It does not
pretend that this digest is the Ethereum RPC transaction hash; the RPC hash is
retained in off-chain evidence and worker artifacts.

## Local setup

The pinned toolchain is Node `24.14.0`, pnpm `11.22.0`, Foundry `1.7.1`, and
Solidity `0.8.28`. The Foundry EVM target is London because CC3 testnet
headers do not expose `prevrandao`; this is required for script simulation and
broadcast compatibility.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

Useful focused commands:

```bash
forge test --root contracts -vvv
forge test --root contracts --gas-report
pnpm --filter @pegshield/worker test
pnpm --filter @pegshield/worker build
node worker/dist/cli.js config validate
node worker/dist/cli.js proof inspect --file worker/fixtures/historical-proof.json
node worker/dist/cli.js proof encode --file worker/fixtures/historical-proof.json --out /tmp/pegshield-proof.hex
node worker/dist/cli.js events scan --from-block <start> --to-block <end> --trigger-below <feed-units>
node worker/dist/cli.js proof simulate --policy <id> --first-file proofs/<first>.json --confirmation-file proofs/<later>.json
# proof submit is permissionless but requires a locally configured relayer key:
node worker/dist/cli.js proof submit --policy <id> --first-file proofs/<first>.json --confirmation-file proofs/<later>.json
pnpm --filter @pegshield/web build
pnpm preflight:deployment
pnpm demo:trigger -- --margin-bps 100
```

### Getting demo TestUSD

TestUSD is the deployment’s six-decimal, testnet-only ERC-20 at
`0xA82e7ED8a10DA85d64E3C41D0fFbE5B95E1B30F9`. It has no public faucet: only
the explicitly authorized `MINTER_ROLE` operator can mint it. For a browser
rehearsal, add that contract to the wallet with symbol `tUSD` and six decimals,
then have the demo operator mint or transfer at least the quoted premium to the
connected CC3 address. A 100-TestUSD policy requires 2.5 TestUSD plus native
CTC for gas. Never use production assets or expose private keys.

The preflight command is read-only. It checks both RPC chain IDs, discovered
dependency availability/code hashes, the pinned Ethereum aggregator, a real
BlockProver call using the committed fixture, and ChainInfo’s latest
attestation. The deployment script requires environment-only keys and refuses
any non-CC3 network. Start from [`.env.deploy.example`](.env.deploy.example);
do not fill it in a commit. After deployment, `pnpm deploy:manifest` reads the
broadcast receipts, verifies live roles/product/policy/code hashes, and writes
the public manifest. Claim simulation and submission consume that manifest and
the exact normalized proof artifact; no decoded price is accepted as input.
Use `pnpm demo:trigger -- --margin-bps 100` immediately before deployment to
derive `DEMO_TRIGGER_BELOW` from the current signed source answer. The command
prints a clearly labeled test-only threshold; review it and copy only the
`envLine` into your local `.env.deploy`.

If a CC3 RPC interruption leaves later setup calls outside Foundry's broadcast
receipt list, pass their independently verified hashes explicitly, for example:
`pnpm deploy:manifest -- --product-tx-hash <createProduct-tx> --policy-tx-hash
<buyPolicy-tx>`. The generator fetches and validates those receipts live before
writing the manifest.

## Trust and limitations

PegShield trusts the public CC3 verifier dependencies, Ethereum receipt data,
and underwriter-deposited TestUSD. It does not trust a relayer, browser state,
caller-selected beneficiary, or caller-supplied price/round/timestamp. The
prototype intentionally omits governance, upgrades, cancellation, refunds,
cross-chain payout assets, and production economic parameters. The live
deployment and browser E2E evidence are complete. Public explorer and frontend
links are provided separately with the release submission.

## License

MIT. See [`LICENSE`](LICENSE).
