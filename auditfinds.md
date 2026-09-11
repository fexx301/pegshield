# PegShield — Full Code Review Findings

- **Date:** 2026-09-11
- **Scope:** entire repository — contracts (`src`, `script`, `test`), worker package, web app, scripts, CI, configs, schemas, manifests
- **Method:** 100% of `contracts/src` + `contracts/script` + all 9 test files read directly; worker/web/scripts layers reviewed and every medium finding re-verified firsthand against source before inclusion; cross-layer ABI/protocol seam checked end-to-end manually; live CC3/Ethereum RPC checks run read-only
- **Mode:** audit only — no changes made

## Overall verdict

**No critical or fund-loss path found.** The on-chain core (pool accounting, claim predicate, adapter boundary) is sound and well-tested for a hackathon prototype. Seven medium defects exist in tooling, worker, and web; none affect on-chain fund safety. All severity ratings below are in hackathon/demo context — the README already discloses the production omissions (no governance, upgrades, cancellation, refunds).

Severity counts: **0 critical / 0 high / 7 medium / 11 low / 8 info.**

---

## Medium

### M1 — `.env.deploy.example` ships a deployment-breaking value
- **Where:** `.env.deploy.example:20`; `contracts/src/PegShieldPool.sol:54,381`; `contracts/script/Deploy.s.sol:205-207`
- **Evidence:** example ships `DEMO_ACTIVATION_DELAY=30`; pool requires `MIN_ACTIVATION_DELAY = 5 minutes` and `_validateProduct` reverts below 300; `Deploy.s.sol` feeds the env value straight into `createProduct`.
- **Impact:** Following the README's "start from `.env.deploy.example`" verbatim, the broadcast reverts at product creation *after* TestUSD/adapter/pool are already deployed — partial deployment, no manifest written. The `30` predates commit `6fe69dd`, which introduced the 300 minimum (the commit the v3 manifest records). Adjacent gap: repeat deployments need the undocumented `DEPLOYMENT_MANIFEST_PATH` override to pass `Deploy.s.sol:60-64`'s `FinalDeploymentManifestExists` guard.
- **Fix:** change the example to `300` and document `DEPLOYMENT_MANIFEST_PATH`.

### M2 — `validate-json.mjs` exits 0 when the data file is missing
- **Where:** `scripts/validate-json.mjs:12-17`; gates at `.github/workflows/ci.yml:58-60`
- **Evidence:** missing schema *or data* file prints "validation deferred" and `process.exit(0)`. Verified live: a nonexistent deployment path validates "successfully."
- **Impact:** the `validate:proof` / `validate:deployments` CI gates pass silently if `worker/fixtures/historical-proof.json` or any `deployments/*.json` is deleted or misnamed — exactly the artifacts the gates protect.
- **Fix:** defer only for a missing schema; hard-fail on missing data (optional `--allow-missing` for generate-time callers).

### M3 — `.env.example` pins worker tooling to the superseded v1 pool
- **Where:** `.env.example:14`; `worker/src/cc3Client.ts:164,222`
- **Evidence:** `DEPLOYMENT_MANIFEST=deployments/cc3-testnet.json` (v1) and the same v1 path is `cc3Client.ts`'s hardcoded fallback; README declares v3 the live deployment.
- **Impact:** with `PEGSHIELD_POOL_ADDRESS` empty as shipped, the documented `proof simulate --policy 1` flow validates the code hash of, and simulates against, the superseded v1 pool, where policy 1 is a different, already-settled policy.
- **Fix:** point the example at `deployments/cc3-testnet-v3.json`.

### M4 — Worker: in-flight proof dedup breaks on request timeout
- **Where:** `worker/src/server.ts:286-290` (eviction), `:260-261` (contradicting comment), `:266-270` (`withTimeout`), `:242-253` (4-slot `activeBuilds` cap)
- **Evidence:** the `finally` block evicts the in-flight entry when the *awaiting request* settles — including its 30s timeout — not when the *build* settles. The comment claims "The active promise is never evicted."
- **Impact:** a 90s proof service call with `requestTimeoutMs=30s` lets every client retry spawn a duplicate build of the same proof, each consuming one of the 4 build slots → 503 `PROOF_CAPACITY` for genuinely new proofs while only one unique proof is in flight.
- **Fix:** evict from the build's own settlement (`pending.then(cleanup, cleanup)` with identity check); add a regression test.

### M5 — Worker: dead error-classification branch mislabels permanent failures as retryable
- **Where:** `worker/src/server.ts:361-366`; `worker/src/proofBuilder.ts:107-114`
- **Evidence:** classification matches `message.includes("receipt log shape")`, but the only shape error producer throws `"locked AnswerUpdated log shape is malformed"` — the substring never matches (no producer exists anywhere in `worker/src`).
- **Impact:** a receipt with topic count ≠ 3 or data ≠ 32 bytes deterministically returns 502 `PROOF_SERVICE_FAILED` with `retryable: true` instead of the intended 422 non-retryable — an automated relayer retries a permanently-failing request indefinitely, and operators get a misleading "service failure" diagnosis.
- **Fix:** typed `WorkerError`s in `proofBuilder`; classify by code, not substrings; HTTP shapes unchanged.

### M6 — Web: tab refocus can silently switch policy and wipe prepared claim evidence
- **Where:** `web/components/PegShieldDashboard.tsx:255-261` (selection), `:425-427` (wipe effect); `web/components/Web3Provider.tsx:9`
- **Evidence:** without a `?policy=` URL param, `selectedPolicyId` follows `latestPolicyId`; default `QueryClient()` enables react-query's `refetchOnWindowFocus`; the effect `useEffect(() => { acceptPrepared(); }, [selectedPolicyId, acceptPrepared])` wipes both artifacts and the 90s freshness window on every policy-id change.
- **Impact:** claimant prepares evidence for policy 5, another user buys policy 6, claimant refocuses the tab (e.g. returning from an etherscan link) → selection flips to 6 and prepared evidence is silently discarded. No funds at risk (CC3 simulation rejects mismatched pairs).
- **Fix:** pin the selection once evidence exists (or set `requestedPolicyId` on first successful policy load).

### M7 — Web: cross-origin GETs bypass the origin guard and can starve discovery
- **Where:** `web/app/api/claims/[policyId]/route.ts:19-27` (POST-only origin check), `:34-38` (4-job cap); cost source `web/lib/claim-service.ts:101-214`
- **Evidence:** the CSRF-style guard covers POST only; GET performs CC3 reads + Ethereum binary search + chunked `getLogs`.
- **Impact:** any third-party page can rotate simple cross-origin GETs across valid policyIds (no preflight needed) to defeat the 30s per-policy cache and hold all 4 concurrent-job slots → 503 for legitimate users. Bounded per serverless instance and by the 55s timeout.
- **Fix:** per-IP rate limiting in front of discovery (keep GET public per README's documented API), not an origin lock on GET.

---

## Low

| # | Where | Finding |
|---|---|---|
| L1 | `worker/src/config.ts:76` | `MAX_RETRIES` parsed and exposed but no retry loop exists anywhere in `worker/src` — advertised knob is a no-op |
| L2 | `worker/src/cli.ts:25-28` | `flag()` blindly takes the next argv token: `--tx --out x` yields `transactionHash="--out"`; trailing valueless flag silently disables the filter; errors point at the wrong cause |
| L3 | `worker/src/proofArtifact.ts:197`, `cli.ts:201`, `proofBuilder.ts:76`, `eventScanner.ts:132`, `discover.ts:217`, `fixture.ts:382` | `new URL(...).pathname` for repo paths breaks (percent-encoded ENOENT) on directories containing spaces/non-ASCII. Latent — current path is clean. Use `fileURLToPath` |
| L4 | `worker/test/scanner.test.ts` | Suite tests only `decodeAnswerUpdatedLog`; the strict-below trigger filter (`eventScanner.ts:163-167`), 10k-block cap, and `receiptLogPosition` logic are untested — a `>=`→`>` regression would pass CI |
| L5 | `web/lib/claim-service.ts:275,282` | `headerNumber: Number(receipt.blockNumber)` is assigned then "validated" against itself — that arm of the proof-identity check is dead code; the prover's own anchor is never compared (worker's equivalent does compare) |
| L6 | `web/lib/claim-service.ts:123-129` | Pool's `getPolicy` reverts `UnknownPolicy` for unpurchased IDs, so `policy.productId === 0n` is unreachable; a typo'd policy number gets 502 "please retry shortly" for an operation that can never succeed |
| L7 | `web/components/PegShieldDashboard.tsx:631-670` | Proof file inputs never reset `event.target.value`; after a failed validation, re-selecting the same fixed file fires no `change` event — manual recovery path appears broken |
| L8 | `web/lib/claim-service.ts:168-188` | Per-chunk `getLogs` + `getBlock` round-trips: a no-pair scan near the end of a 7-day policy (~51 chunks) can exceed the 55s route budget → intermittent 502s (confidence 0.6) |
| L9 | `.github/workflows/ci.yml:27-43` | CI never runs the prettier gate that `pnpm check` claims — TS/JSON format drift merges on green CI |
| L10 | `scripts/abi-check.mjs:164-180` | TS-side verification is a name-substring match (`webSource.includes('name: "..."')`); cannot catch arity/type drift in the hand-maintained viem ABI fragments (currently correct — a gate weakness, not a live bug) |
| L11 | `scripts/generate-deployment-manifest.mjs:376-378` | `solc`/`optimizerRuns`/`evmVersion` hardcoded, not derived from `foundry.toml`; a config change silently attests stale build provenance into a schema-valid manifest |

Also: `docs/schemas/deployment.schema.json:113` permits `premiumBps: 10000` but the pool forbids > 9999 (`MAX_PREMIUM_BPS`, `PegShieldPool.sol:55`) — latent, all manifests use 250. And `scripts/preflight-deployment.mjs:252` — `main().catch(() => fail(...))` discards all error detail behind a generic message (the other two scripts print `error.message`).

---

## Info

- **`PolicyState.BreachObserved` is dead** — `submitClaim` goes Active → Claimed directly (`PegShieldPool.sol:236`); nothing can set BreachObserved, so `expirePolicy`'s acceptance of it (line 255) is unreachable. Enum layout is frozen against deployed bytecode — do not renumber.
- **Tautological check** — `PegShieldPool.sol:350` re-checks `source.receiptLogPosition != receiptLogPosition`; the adapter returns the same argument by construction. Cheap interface defense-in-depth; harmless.
- **`Deploy.s.sol` dead code** — `_fixtureProof` (lines 163-197) has no callers (grep-verified); `TREASURY_ADDRESS` is validated (line 105) but never used on-chain, only echoed to the manifest.
- **`rawSdkJsonSha256` semantic drift** — web digests the zod-normalized single-proof object (`claim-service.ts:313`); worker digests the raw SDK response. Same field name, different meaning; harmless today (only pattern-checked) but misleading for future consumers.
- **`selectPair` stricter than the contract** — dedupes by transaction hash (`eligibility.ts:44`) whereas the contract's `eventId` distinguishes two logs in one tx. Unreachable for the locked aggregator (one AnswerUpdated per update tx); documented decision, not an accident.
- **ClaimProgress extra fetch** — the polling effect's immediate `run(false)` fires on every `submitting` transition, beyond the 60s cadence. Harmless (server-cached 30s, read-only).
- **GET cache evicts FIFO, not LRU** — `route.ts:56-57`; re-setting an existing Map key keeps its original insertion position, so the hottest entry is evicted first at capacity (100). No correctness impact at demo scale.
- **CI runs twice on PR branches** — `ci.yml:3-11`: unfiltered `push:` + `pull_request:` with a `github.ref`-keyed concurrency group → no cross-run cancellation. Wasted minutes only.
- **Secret-scan backstop is narrow** — `ci.yml:61-73` misses `PRIVATE_KEY = 0x…` (spaced), JSON-style keys, bare 64-hex values, and excludes `ci.yml` itself. Primary control (`.gitignore`) is verified correct: `.env`, `.env.local`, `.env.deploy`, `web/.env.local` ignored and untracked; committed examples contain only empty placeholders.

---

## Closed: precompile `EXTCODESIZE` concern — disproven

An external review claimed that high-level calls to the codeless CC3 BlockProver precompile (`0x…FD2`) would hit a solc `extcodesize > 0` guard and revert, killing every `submitClaim`. Investigated and **disproven** with live evidence:

1. `eth_getCode(0x…FD2)` and `eth_getCode(0xFD3)` on CC3 RPC return `0x` — the codeless-precompile premise is **confirmed**.
2. Live v3 claim tx `0xc509b357…` (README:133): **status `0x1`**, `to` = v3 pool `0x9be0…b27b`, 4 logs (BreachObserved, ConfirmationObserved, PolicyPaid, Transfer) — the full two-proof path succeeded on-chain through the adapter.
3. Deployed adapter bytecode ≡ current source, **byte-for-byte** after patching the two deploy-time immutables (`0x…FD2` at bytes 153/498, decoder `0x731c…` at 230/681); identical IPFS metadata hash `6e529895…` proves same source + settings; live hash `0xfe5bb8de…` matches the v3 manifest.
4. Disassembly of that exact bytecode: **zero `EXTCODESIZE` opcodes in the entire contract.** All four dependency call sites (`verify` `0x7cc4e258` → STATICCALL at `0x21d`, `getTransactionType` `0xcf0d21c9`, `isValidTransactionType` `0x78190020`, `decodeReceiptFields` `0x0dd5c77e`) compile to bare `STATICCALL` + success-flag check + revert-bubble + ABI-decode. CC3's host precompile answers with a properly ABI-encoded `true`.

**Adopted residual (low, hardening):** nothing automated exercises the *deployed adapter's compiled* call path against the live prover — unit tests bind a bytecode mock, `Deploy.s.sol:135-141` admits local revm cannot execute host precompiles, and `preflight-deployment.mjs:195-198` probes via raw `eth_call` (different semantics than compiled code). Add a post-deploy `eth_call` of `adapter.verifySourceLog(fixtureProof, 0)` with the committed fixture, with staleness-aware messaging (the fixture's continuity proof ages out; a failure must read as "refresh needed," not "adapter broken"). The raw-`staticcall` rewrite is *not* recommended: it forks source from all three pinned manifests for a hypothetical codegen change.

## Corrected: payout verifiability / staleness

An earlier draft of the external review called policy 1's payout unverifiable from the checkout. **Withdrawn as overstated**: `README.md:133` links the v3 payout tx directly (plus v1 payout at :136-137). The accurate residual is an info-level staleness nit only: `deployments/cc3-testnet-v3.json:93` (`"state": 0`) and `docs/evidence/P27-atomic-v3.md:36` (policy 1 `Active`, 100,000,000 reserved) are pre-settlement snapshots that now contradict README's "completed payout" status. These are deployment-time evidence records — do **not** edit them to say `state: 2`; at most add a one-line note that they are pre-settlement snapshots with the README links as live status.

---

## Verified sound

**On-chain core (no fund-loss path found):**
- Accounting: exact token-delta pull/push (`_pullExact`/`_pushExact` reject fee-on-transfer and deflation), effects-before-transfer ordering, `nonReentrant` on every state-changing entry, underwriter withdraws only unreserved capital, direct donations don't inflate accounting. Invariants (`reserved ≤ accounted ≤ token balance`) hold; the ERC20-callback reentrancy test confirms the guard.
- Claim predicate: every check reverts fail-closed — receipt status, chain key, emitter, topic0, positive answer, strict-below threshold, inclusive coverage window, strictly-later confirmation (roundId *and* timestamp), `minBreachDuration`, per-policy replay map. Atomic two-proof settlement prevents a permissionless relayer from pinning an unusably late first observation. Premium-as-backing is intentional and tested.
- Adapter: opaque proof bytes → BlockProver verify → decoder receipt extraction; envelope digest (not RPC hash) for event IDs; bounds-checked log position; tx-type allowlist.

**Cross-layer seam (checked end-to-end):**
- `submitClaim(uint256,bytes,uint256,bytes,uint256)` — identical 5-arg ABI in the pool, `worker/src/cc3Client.ts:34-48`, `web/lib/chain.ts:131-145`.
- Proof tuple `(uint64,uint64,bytes,MerkleProof,ContinuityProof)` — byte-identical encoding between worker `proofEncoder.ts` and web `proof.ts`, matching the adapter's `abi.decode`.
- Threshold semantics agree across all three layers: pool reverts `answer >= triggerBelow`; web filters `answer < triggerBelow`; worker scanner keeps `answer < triggerBelow`.
- `AnswerUpdated` topic0 = `cast keccak("AnswerUpdated(int256,uint256,uint256)")` = `0x0559884f…` — matches `ChainlinkAnswerUpdated.sol`, all tests, web, worker (executed, not assumed).
- Policy state mapping (web `state === 2` = Claimed, `3` = Expired) matches the enum; `now > endsAt + claimGracePeriod` matches `_requireSubmissionOpen`.
- Web artifacts pass their own checksum validation; worker additionally pins artifacts to the discovery lock and raw sidecar hash.
- API route: strict policyId regex, 512 KiB upstream bound, 55s abort under `maxDuration: 60`, correct pending dedup/active accounting, no caller-controlled URLs (no SSRF), upstream URLs redacted from logs, fixed client error message.
- Wallet flows: simulate-before-sign, fresh re-simulation immediately before the claim write, chain ID 102031 gating, exact-premium approve, 20% gas buffer.
- v3 manifest internally consistent (addresses, chain ID, decoder code hash `0xb549c9d8…` matches `Deploy.s.sol`'s pin, product terms within contract bounds).

---

## Fix plan

**Order:** M1 → M2 → M5 → M4 → M6 → M3 → M7, then lows (L4 and L10 are the best-value gate/test hardening), then info items opportunistically.

**Dispositions requiring a decision:**
1. **Adapter `staticcall` hardening** — recommend **against** rewriting the call pattern (deployed bytecode is live-verified through a real payout; changing it forks source from all three pinned manifests). Recommend **for** adding the post-deploy adapter probe (see Closed section).
2. **Manifest/evidence staleness** — recommend a documentation note only; do not regenerate or edit historical evidence records.
3. **`Deploy.s.sol` dead code** — delete `_fixtureProof` (no callers); leave `TREASURY_ADDRESS` (part of the documented deploy env contract and manifest shape).

**Deliberately not changing:** `PolicyState.BreachObserved` (layout frozen), the tautological `receiptLogPosition` re-check (cheap defense-in-depth), `selectPair`'s transaction-hash dedupe (stricter than the contract, documented).

**Verification after fixes:** `forge test --root contracts` (only `Deploy.s.sol` touches contracts); worker vitest incl. new dedup/scanner/CLI tests; web vitest + `next build` + local Playwright e2e; `validate-json.mjs` negative case proving exit 1; `abi-check` green; live read-only preflight. Live-prover-dependent behaviors (L5 probe, post-deploy adapter probe) verified against CC3/Ethereum RPCs read-only.

---

## Fix outcome (2026-09-11, same session)

All findings fixed per the approved plan and dispositions (probe-only, doc-note-only,
delete-`_fixtureProof`-only). Status:

| Finding | Status | Verification |
|---|---|---|
| M1 deploy env | Fixed (`300` + `DEPLOYMENT_MANIFEST_PATH` doc) | manual read |
| M2 validator | Fixed (missing data exits 1; `--allow-missing` opt-out) | negative + 4 positive runs |
| M3 env example | Fixed (v3 manifest) | manual read |
| M4 dedup | Fixed (settlement-based eviction + cache-set) | new regression test fails on old code; 27/27 worker tests |
| M5 error mapping | Fixed (typed `WorkerError` codes; substring matching removed) | new mapping test fails on old code |
| M6 policy pin | Fixed (one-time `autoPolicyId`) | **browser-verified live**: `nextPolicyId` response rewritten 7→8 during focus refetch; count updated to 7, selection stayed pinned at policy 06 |
| M7 GET rate limit | Fixed (per-identity 20/min, 1024-identity cap, GET only) | unit tests incl. window expiry + identity cap |
| L1 MAX_RETRIES | Removed | grep + tests |
| L2 CLI flags | Fixed (reject `--` values, name in errors) | new CLI test |
| L3 fileURLToPath | Fixed at all 6 sites | typecheck |
| L4 test gaps | Added scanner/CLI/server tests (21→27) | mutated-filter test fails on `>=`→`>` regression |
| L5 header check | Dead arm removed with comment | live prover probe: batch entries carry only `txHash`/`txBytes`/`merkleProof` — no headerNumber to check |
| L6 404 | Fixed (`PolicyNotFoundError` → 404) | unit test |
| L7 file input | Fixed (value reset) | **browser-verified live**: same-path re-upload of corrupted file fired change, cleared stale artifact |
| L8 scan budget | Fixed (end-block binary search, no per-chunk probe) | unit test pins chunk count |
| L9 CI format gate | Added `pnpm format:ts:check` to CI; repo formatted. **Post-review correction:** the initial edit accidentally replaced `pnpm install --frozen-lockfile` and deleted `status=$?` from the secret scan (both caught by external re-review, not by local verification — local `pnpm check` runs with deps installed and never exercises CI structure). Both restored. | YAML parse valid; scan logic empirically tested: clean repo → exit 0, planted `PRIVATE_KEY=0x…` → exit 1 with diagnostic, spaced `= ` variant caught; install→format→lint ordering confirmed in diff |
| L10 abi-check | Fixed (parses real TS ABI exports, full signature/type comparison) | injected `uint256`→`uint64` mutation now fails with precise error |
| L11 manifest metadata | Fixed (parsed from `foundry.toml`) | parser output matches previous literals; committed manifests still validate |
| Info items | LRU refresh, ClaimProgress gate, rawSdk digest alignment, schema 9999, secret-scan spacing, CI push filter, preflight error detail | checks above |
| Advisory probe | Added `ADAPTER_ADDRESS` post-deploy probe to preflight | **live-verified against v3 adapter** — fixture authenticated through deployed `verifySourceLog` |
| Staleness notes | Added to P27 + README (snapshot semantics); README test count 62→58 | manual read |
| Deploy dead code | `_fixtureProof` + `FIXTURE_SIBLING_COUNT` + unused imports deleted | `forge build` + 58/58 tests (count unchanged pre/post) |

Final gate: `pnpm check` (format, lint, typecheck, all tests, builds, abi-check, all
schema validations) passes end-to-end; Playwright e2e 4/4; live read-only preflight
green including the adapter probe.
