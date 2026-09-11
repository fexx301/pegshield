# PegShield

PegShield is a **testnet prototype for fixed-payout USDC depeg protection on
Creditcoin CC3**. Buying a policy reserves a fixed TestUSD payout from an
underwriter-funded CC3 pool and locks the beneficiary and claim rules. The
policy can settle later if a pinned Ethereum USDC/USD feed records the required
price observations.

This is a hackathon prototype, not insurance, a stablecoin, or financial
advice. The payout token is six-decimal demo `TestUSD`; never send production
assets or private keys to this repository.

## In 30 seconds

### The problem

A lending market, credit protocol, or RWA vault can depend on USDC while its
liquidity lives on another chain. When USDC moves below a chosen threshold,
the application needs a payout it can verify without trusting a private
operator to report the event correctly.

### The product

An underwriter (the pool funder) deposits demo TestUSD into a visible CC3 pool.
A user buys a policy, chooses the beneficiary, and pays a one-time premium. The
policy records its coverage, premium, beneficiary, timing, and immutable
product reference; that referenced product fixes the feed, threshold, and
minimum observation interval.

If the policy later has two qualifying observations, anyone can submit the
corresponding proofs. CC3 verifies both proofs and pays the exact locked
coverage atomically. The user does not have to trust the relayer, the browser,
or PegShield's server to choose the price or beneficiary.

### The trust boundary

| Layer              | Responsibility                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Ethereum**       | Supplies the source observation: the pinned USDC/USD aggregator emits an `AnswerUpdated` event.                        |
| **Attestcoin**     | Authenticates each Ethereum receipt and anchors its source block in Attestcoin's accepted header history.              |
| **PegShield**      | Reads the authenticated event and checks the policy terms: feed, topic, threshold, timing, replay status, and reserve. |
| **Creditcoin CC3** | Enforces the decision on-chain and transfers the fixed TestUSD payout to the beneficiary stored in the policy.         |

In one sentence: **Ethereum observes, Attestcoin proves, PegShield evaluates,
and CC3 settles.** Attestcoin is pivotal because the CC3 contract can verify
Ethereum evidence without trusting PegShield's server or a relayer's claim
about what happened.

### Two words to know

- **Depeg:** the source USDC/USD answer is below the policy's configured
  threshold. This demo deliberately uses a visible testnet threshold; it is
  not a claim that USDC experienced a real economic depeg.
- **Policy:** the on-chain record that links fixed product rules to the buyer,
  beneficiary, coverage, premium, and timing. Purchasing it transfers the
  premium into the pool and reserves its fixed coverage amount. The payout is
  not reimbursement for a user's measured loss.

### Technical terms

- **Receipt:** Ethereum's transaction record, including the logs emitted by the
  aggregator. PegShield needs the receipt, not a relayer's summary of it.
- **Attestcoin proof:** a proof artifact that lets CC3's verifier authenticate
  the receipt and the selected `AnswerUpdated` log.
- **Relayer:** any permissionless account or service that submits proof bytes to
  CC3. It can pay gas, but it cannot change the policy terms or force a payout.
- **Continuity:** the proof component that anchors each source block in
  Attestcoin's accepted Ethereum header history. PegShield—not the continuity
  proof—checks that the two authenticated observations are ordered and
  sufficiently far apart. It does not prove the price remained below the
  threshold between them.
- **Aggregator:** the pinned Ethereum smart contract that publishes the
  USDC/USD price-feed updates PegShield accepts.
- **Accepted source-block window:** the Ethereum block-header history that
  Attestcoin and CC3 currently recognize for proof verification. As this
  attestation window advances, older proof artifacts can expire.

## Start here: the user flow

The public dashboard has three useful paths. They are intentionally separate so
someone can understand the product before connecting a wallet.

### 1. Fastest path — completed payout, no wallet

1. Open [the completed-policy walkthrough](https://web-three-zeta-pp0cpatyl9.vercel.app/?policy=1).
2. Choose **Explore a completed payout**.
3. Follow the visible timeline: purchase → two Ethereum observations →
   Attestcoin verification → atomic CC3 payout.
4. Open the linked explorer transactions to verify the exact policy purchase,
   proofs, and 100 TestUSD transfer.

This path is deterministic and does not claim a live economic depeg. It is the
best first read or screen-recording path.

### 2. Policy 2 — inspect discovery and prepare a claim

1. Open the [policy-2 claim-preparation path](https://web-three-zeta-pp0cpatyl9.vercel.app/?policy=2).
2. Read the policy terms and wait for the panel to report its current
   observation state. The app checks while the page is visible.
3. When it reports that the policy is eligible, select **Prepare claim**.
   The app discovers the two source events, obtains Attestcoin proof artifacts,
   and simulates the CC3 transaction before asking for a signature.
4. Review the proof and simulation result. A successful preparation means the
   evidence currently simulates successfully; the app re-simulates before
   requesting a signature, because proof freshness can change.

Policy 2 was verified as eligible on 2026-09-06, but its on-chain state is
time-dependent. Treat the panel's current status as authoritative; the URL is
an example, not a permanent eligibility promise.

Oracle update times are not guaranteed. Two observations must qualify under the
policy's interval and threshold; they do not prove that the price stayed below
the threshold continuously between them. Proofs can age out as Attestcoin's
accepted source-block window advances, so refresh evidence close to simulation
time.

### 3. Full wallet path — buy and claim your own policy

1. On the dashboard choose **Buy test coverage** and connect a CC3 testnet
   wallet.
2. Review the displayed coverage, exact premium, beneficiary, activation delay,
   duration, threshold, and observation interval. Approve the premium, then
   confirm the purchase. Save the resulting policy URL; it encodes the policy
   number so the dashboard can reopen it later.
3. Fund the wallet with native testnet CTC for gas and enough six-decimal
   TestUSD for the quoted premium. The token has no public faucet; see
   [Getting demo TestUSD](#getting-demo-testusd).
4. After activation, wait for the policy panel to report qualifying
   observations. Select **Prepare claim**, inspect the simulation, then select
   **Claim payout** and confirm the CC3 transaction in the wallet.
5. After confirmation the policy becomes `Claimed`, the stored beneficiary
   receives exactly the stored coverage, and the dashboard links the payout
   receipt. A second submission is rejected by replay protection.

The claim controls are wallet-gated. The browser and the automatic service can
prepare evidence, but neither can sign or broadcast a transaction for you.
Proof JSON upload and inspection remain available under **Advanced** if an RPC
provider cannot serve the automatic discovery request.

## What is live and what is proven

The public CC3 deployment is live on testnet (chain ID `102031`). Policy 1
completed the v3 atomic two-proof path: Ethereum rounds 1171 and 1172 were
authenticated in one transaction and the pool transferred exactly 100 tUSD to
the beneficiary locked at purchase.

The repository also contains a reproducible offline core:

- `AttestcoinVerifierAdapter` calls the official Attestcoin proof boundary and
  exposes only an authenticated receipt log. See
  [`contracts/src/AttestcoinVerifierAdapter.sol`](contracts/src/AttestcoinVerifierAdapter.sol)
  and [adapter evidence](docs/evidence/P07-adapter.md).
- `PegShieldPool` implements immutable terms, exact token-delta accounting,
  expiry, replay protection, effects-before-transfer ordering, and atomic
  two-proof settlement. See
  [`contracts/src/PegShieldPool.sol`](contracts/src/PegShieldPool.sol) and
  [claim evidence](docs/evidence/P08-claims.md).
- The worker discovers source events, builds and normalizes proof artifacts,
  and emits claim calldata without holding a signing key. See
  [`worker/src/discover.ts`](worker/src/discover.ts),
  [`worker/src/proofBuilder.ts`](worker/src/proofBuilder.ts), and
  [worker evidence](docs/evidence/P10-worker.md).
- The Next.js dashboard reads the pool, shows policy state, and gates purchase
  and claim writes behind the connected wallet. See
  [`web/components/PegShieldDashboard.tsx`](web/components/PegShieldDashboard.tsx)
  and [browser-path evidence](docs/evidence/P23-browser-write-path.md).
- The automatic web proof path is implemented in
  [`web/lib/claim-service.ts`](web/lib/claim-service.ts),
  [`web/lib/proof.ts`](web/lib/proof.ts), and
  [`web/app/api/claims/[policyId]/route.ts`](web/app/api/claims/[policyId]/route.ts).
- The pinned Attestcoin/CC3 discovery lock, verified Ethereum fixture, and
  v3 deployment manifest are committed in
  [`docs/discovery-lock.json`](docs/discovery-lock.json),
  [`worker/fixtures/historical-proof.json`](worker/fixtures/historical-proof.json),
  and [`deployments/cc3-testnet-v3.json`](deployments/cc3-testnet-v3.json).

  Note: the manifest's `demoPolicy.state` is a deployment-time snapshot;
  live status is the settlement receipt linked under
  [Public evidence](#public-evidence).

The current suites are 58 Foundry tests and 27 worker tests, including
256-run invariants and an ERC-20 callback/reentrancy test, plus a web build
and a local Playwright smoke test. Earlier recorded runs remain in
[contract evidence](docs/evidence/P09-contract-gas.md),
[worker evidence](docs/evidence/P10-worker.md), and
[browser evidence](docs/evidence/P17-e2e.md). Run the commands in
[Local verification](#local-verification) to reproduce them; counts
may change as the prototype evolves.

## Public evidence

Use these links in order. Historical v1/v2 transactions are retained as
context; the v3 links are the current product path.

### Start with the product

- [Live dashboard — completed walkthrough (policy 1)](https://web-three-zeta-pp0cpatyl9.vercel.app/?policy=1)
- [Live dashboard — policy-2 claim-preparation example](https://web-three-zeta-pp0cpatyl9.vercel.app/?policy=2)
- [CC3 v3 pool](https://creditcoin-testnet.blockscout.com/address/0x9be0af5ad671e1dbb2e9c421f19479c04cf3b27b)
- [CC3 v3 TestUSD](https://creditcoin-testnet.blockscout.com/address/0xa82e7ed8a10da85d64e3c41d0ffbe5b95e1b30f9)
- [CC3 v3 Attestcoin adapter](https://creditcoin-testnet.blockscout.com/address/0x9e1d5aec273802bde517bb55b3dec10b09e71dbf)

### Completed v3 settlement

- [Policy 1 purchase](https://creditcoin-testnet.blockscout.com/tx/0x70e7184d8c7479960827a2f5056e8624a7b95fc49ba0e69af6597d3a588fd7fe)
- [Atomic claim and 100 tUSD payout](https://creditcoin-testnet.blockscout.com/tx/0xc509b3577ebd9cbe3bc65d515e46d90ee88e58a0c97bdf43ae35c338b8ababb5)
- [Ethereum source event, round 1171](https://etherscan.io/tx/0x4876a2e3b835394a51fcab498775821df3c29e817481a890cba24a10a7ae9e32)
- [Ethereum confirmation, round 1172](https://etherscan.io/tx/0x53bb235fb9f71f983e1d602eaedd9a834e153783e50828b23b65750540c451b9)
- [Atomic-settlement evidence](docs/evidence/P28-live-atomic-settlement.md)

### Contracts, worker, and browser evidence

- [Discovery lock](docs/evidence/P02-discovery.md)
- [Verified Ethereum fixture](docs/evidence/P03-fixture.md)
- [Adapter evidence](docs/evidence/P07-adapter.md)
- [Claim and accounting evidence](docs/evidence/P08-claims.md)
- [Worker evidence](docs/evidence/P10-worker.md)
- [Deployment evidence](docs/evidence/P11-deployment.md)
- [Proof-service evidence](docs/evidence/P16-proof-service.md)
- [Browser E2E evidence](docs/evidence/P17-e2e.md)
- [Atomic v3 implementation evidence](docs/evidence/P27-atomic-v3.md)

### Historical context

- [Prior live breach observation](https://creditcoin-testnet.blockscout.com/tx/0xbf43319f0b2adcc95a1c629bb076f588fb884a19b43fc5342d1ba6d7ac5dbaa4)
- [Prior live confirmation and payout](https://creditcoin-testnet.blockscout.com/tx/0x96039de10e844504a847b8f1c1a99e71e58de03b6dd27284d268e9497054e770)
- [Ethereum source event, round 1169](https://etherscan.io/tx/0xb9f980da1350fbb2350fe6b6bdbc3fba3717c556662e3b6b275b495f84ca6eb0)
- [Ethereum source event, round 1170](https://etherscan.io/tx/0x5adcdf88fe55221c6e23d1aad108bf1e75120b0165792a0ed12146159a95cb43)

## Automatic discovery service (advanced)

The deployed Next.js app exposes `GET /api/claims/:policyId` for observation
discovery and `POST /api/claims/:policyId` for proof preparation. Neither
endpoint signs or broadcasts a transaction. Both read the pool's immutable
policy and product terms; callers cannot supply a source feed, RPC URL,
threshold, beneficiary, or transaction hash.

Nearby events use Attestcoin's batch endpoint to refresh their shared continuity
anchor. More distant events use separate single-item batch requests. The CC3
contract simulation remains the final eligibility check.

For a self-hosted deployment, set `NEXT_PUBLIC_PEGSHIELD_POOL_ADDRESS` to the
v3 pool. Optionally set server-only `ETHEREUM_RPC_URL` to a provider that
supports historical block reads and 1,000-block log queries. PublicNode and
dRPC are fallbacks for individual requests when the preferred endpoint is
unavailable. No private key is required.

The service has a 55-second request budget, 512 KiB upstream response limit, a
250,000-block scan bound, and four concurrent jobs per server instance. GET
results are cached for 30 seconds; prepared artifacts are not cached by this
app. These are instance-level safeguards, not a distributed rate limiter.

The public deployment has already been checked against its configured RPC. For
another deployment, verify an unpaid policy's discovery and proof preparation
before publishing it: free public endpoints can reject historical log requests,
and a successful build does not establish live RPC availability. If discovery
fails, the dashboard leaves the policy unchanged, offers retry, and keeps the
advanced proof-upload workflow available.

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

## Local setup and verification

The pinned toolchain is Node `24.14.0`, pnpm `11.22.0`, Foundry `1.7.1`, and
Solidity `0.8.28`. The Foundry EVM target is London because CC3 testnet
headers do not expose `prevrandao`; this is required for script simulation and
broadcast compatibility.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

To launch the dashboard locally after installing dependencies, expose the
public v3 pool address and open `http://localhost:3000/?policy=1`:

```bash
export NEXT_PUBLIC_PEGSHIELD_POOL_ADDRESS=0x9be0af5ad671e1dbb2e9c421f19479c04cf3b27b
pnpm --filter @pegshield/web exec next dev
```

Set server-only `ETHEREUM_RPC_URL` as well if you want the local automatic
discovery and proof-preparation routes; the completed walkthrough works without
a wallet or a private key.

### Local verification

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
pnpm --filter @pegshield/web e2e
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
Continuity proofs can age out as Attestcoin's accepted source-block window
advances.
Generate or batch-refresh both artifacts shortly before simulation; a locally
cached JSON file is not evidence that its old continuity path remains valid.
Use `pnpm demo:trigger -- --margin-bps 100` immediately before deployment to
derive `DEMO_TRIGGER_BELOW` from the current signed source answer. The command
prints a clearly labeled test-only threshold; review it and copy only the
`envLine` into your local `.env.deploy`.

If a CC3 RPC interruption leaves later setup calls outside Foundry's broadcast
receipt list, pass their independently verified hashes explicitly, for example:
`pnpm deploy:manifest -- --product-tx-hash <createProduct-tx> --policy-tx-hash
<buyPolicy-tx>`. The generator fetches and validates those receipts live before
writing the manifest.

## Trust, scope, and limitations

### Depends on

PegShield depends on the integrity and availability of the pinned Ethereum
price feed, the public Attestcoin and CC3 verifier components, the TestUSD
token behaving as documented, and sufficient TestUSD backing in the pool.

### Does not trust during claims

The claim path does not trust a relayer's word, browser state, or caller-
supplied price, round, timestamp, feed, or transaction hash. A claimant cannot
replace the beneficiary chosen at purchase. The authenticated receipt and all
policy terms are checked on-chain.

### Out of scope for this prototype

Governance, upgrades, cancellation, refunds, cross-chain payout assets,
pull-payment recovery for a beneficiary that rejects the payout token, and
production economic parameters are intentionally omitted. The depeg predicate
is exactly two qualifying observations at least the configured interval apart;
it does not prove that no recovery occurred between those observations.

Funded credentials and wallet-linked rehearsal evidence remain local and
ignored. Public technical evidence is linked above in [Public evidence](#public-evidence);
private planning and release notes are kept outside public history.

## License

MIT. See [`LICENSE`](LICENSE).
