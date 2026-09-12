# DoraHacks submission package — BUIDL CTC 2026 Fall

Everything needed to submit PegShield. Paste the description, add the links
from the verify table, and submit before **2026-09-14 04:59 UTC**.

## Submission description (paste as-is)

PegShield — parametric USDC depeg protection, settled by Attestcoin.

A user buys fixed-coverage depeg protection on Creditcoin CC3. When the pinned
Ethereum USDC/USD aggregator publishes two qualifying below-threshold updates,
anyone submits the two Attestcoin proofs in ONE atomic CC3 transaction. The
pool verifies inclusion (BlockProver 0x0FD2), continuity, receipt status,
emitter, chronology, interval, coverage window, and replay status — then pays
the exact locked coverage to the beneficiary stored at purchase. No
settlement operator asserts anything — the contract re-derives the answer,
round, and timestamp from the Ethereum receipts themselves.

An oracle can assert a depeg. PegShield's contract verifies the receipt of the
Chainlink transmission itself. The adjuster becomes an on-chain fact.

Live and settled (verify in five minutes):
• SAME-DAY v4 atomic claim + 100 tUSD payout (2026-09-12, purchase-to-payout
in 14 minutes):
https://creditcoin-testnet.blockscout.com/tx/0x575030ff19daffcbbc004f66fdf00cd1489341b3de80bcc424c5a32acc2120c8
• v4 source events: Ethereum rounds 1187/1188, exactly 1h apart,
inclusion-proven via Attestcoin
• First end-to-end settlement (v3, 2026-09-04): receipt + rounds 1171/1172
in the verify table
• Fresh v4 pool with underwriter-funded reserves, exact accounting,
premiums, expiry — schema-validated manifest
• 58 Foundry tests (invariants, reentrancy), full CI green, ABI drift gates,
pinned official dependency code hashes

Depth beyond a single event read: two proofs with ordering constraints settled
atomically (solves a named relayer griefing vector), per-policy replay keys on
attested event identity, and an operational study of Attestcoin proof lifetime
(61-hour continuity survival, single-vs-batch refresh behavior) published back
for other builders.

Cross-chain DeFi use: a CC3 lending market names itself beneficiary — depeg
cover on USDC collateral is what lets undercollateralized lending against it
survive the tail event.

## Verify-everything table (add to the submission's Details)

| What                                                     | Where                                                                                                           |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| v4 SAME-DAY atomic claim + 100 tUSD payout (2026-09-12)  | https://creditcoin-testnet.blockscout.com/tx/0x575030ff19daffcbbc004f66fdf00cd1489341b3de80bcc424c5a32acc2120c8 |
| v4 policy 1 purchase (14 minutes before the claim)       | https://creditcoin-testnet.blockscout.com/tx/0x39359aab37bc067b62bd224dde98f05407bf72dbb90e19053a72dfe0ce0512f2 |
| v4 source, round 1187                                    | https://etherscan.io/tx/0x622e76dad1762307848c53d5554e2f54526107b3a4df486e4ea9441e8adfe02d                      |
| v4 confirmation, round 1188                              | https://etherscan.io/tx/0x6601d8b8013f791c7f73a19105b4ac3308d11ce05348cd80c6d5742c403a61b0                      |
| v4 pool                                                  | https://creditcoin-testnet.blockscout.com/address/0x53712c0cd4edfce30331a7aeac933086ab47c711                    |
| v4 settlement manifest (schema-validated, live-verified) | deployments/cc3-testnet-v4.json in the repo                                                                     |
| Live dashboard — completed walkthrough (v3 policy 1)     | https://web-three-zeta-pp0cpatyl9.vercel.app/?policy=1                                                          |
| v3 atomic claim + 100 tUSD payout (2026-09-04)           | https://creditcoin-testnet.blockscout.com/tx/0xc509b3577ebd9cbe3bc65d515e46d90ee88e58a0c97bdf43ae35c338b8ababb5 |
| v3 policy 1 purchase                                     | https://creditcoin-testnet.blockscout.com/tx/0x70e7184d8c7479960827a2f5056e8624a7b95fc49ba0e69af6597d3a588fd7fe |
| v3 source, round 1171                                    | https://etherscan.io/tx/0x4876a2e3b835394a51fcab498775821df3c29e817481a890cba24a10a7ae9e32                      |
| v3 confirmation, round 1172                              | https://etherscan.io/tx/0x53bb235fb9f71f983e1d602eaedd9a834e153783e50828b23b65750540c451b9                      |
| Source code                                              | https://github.com/fexx301/pegshield                                                                            |
| Why-Attestcoin argument + integration map                | README.md § "Why Attestcoin"                                                                                    |
| Proof-lifetime + gas-estimation studies                  | docs/evidence/P27-atomic-v3.md + P29-v4-deployment.md                                                           |

## Suggested tags

Web3, DeFi, Attestcoin Protocol, Creditcoin, RWA (beneficiary-as-lending-market
framing earns it), Security.

## Demo video script (~3:20, relaxed pace)

Record the screen silently first, then narrate over it in segments — never
talk while clicking. On-screen captions carry the hashes and numbers; never
read a hex string aloud. Every narration line below is under 10 seconds at a
walking pace; static screens (segments 8–9) are free time.

| #   | On screen (record silently)                        | Narration                                                                                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Dashboard hero, slow scroll                        | Insurance claims wait on a decision-maker. In traditional insurance, that's an adjuster. In most on-chain products, it's an oracle operator. Either way — someone tells the contract what happened.                                                                                                                       |
| 2   | Click "Explore a completed payout"                 | PegShield removes the decider. Here's a policy that already paid out — I'll show you exactly how the money moved.                                                                                                                                                                                                         |
| 3   | Step 1: purchase terms                             | The user bought one hundred TestUSD of coverage for a two-point-five TestUSD premium. The beneficiary was locked at purchase — nobody can change it later.                                                                                                                                                                |
| 4   | Step 2: both Etherscan txs (5s each)               | The trigger is the real Ethereum USDC price feed. Two updates landed below the threshold — this one, and a confirmation, an hour apart.                                                                                                                                                                                   |
| 5   | Step 3: verification panel                         | Anyone can submit — it's permissionless. Both proofs went in as a single transaction, and Creditcoin verified the Ethereum receipts themselves: inclusion, continuity, the exact log.                                                                                                                                     |
| 6   | Step 4: payout transfer on Blockscout              | The pool checked every policy term, then paid the exact coverage to the locked beneficiary. One transaction. No adjuster. No operator.                                                                                                                                                                                    |
| 7   | v4 receipt (Blockscout 0x575030ff…), scroll events | And this isn't a one-off — we ran the same flow end to end: purchased at 8:01, claimed at 8:15 the same morning. Here's the receipt: breach observed, confirmation observed, policy paid, token transferred. The accounting balances to the wei.                                                                          |
| 8   | Deck slide 5 (integration map), static             | Why does this need Attestcoin? An oracle can _assert_ that USDC depegged. This contract verifies the _receipt_ of what the aggregator actually published — inclusion-proven, continuity-anchored. The adjuster becomes an on-chain fact. That's PegShield: buy fixed coverage, prove the depeg twice, let Creditcoin pay. |
| 9   | End card: repo + receipt URLs                      | (no narration)                                                                                                                                                                                                                                                                                                            |

To hit 3:00 exactly: cut segment 4's Etherscan visits (keep the narration) and
shorten segment 7 to the event list only.

## Submission checklist

- [ ] Create/submit the BUIDL with the description above
- [ ] Add the verify table + repo link (https://github.com/fexx301/pegshield)
- [ ] Deck PDF URL (requirement): https://raw.githubusercontent.com/fexx301/pegshield/main/docs/pegshield-deck.pdf
- [ ] Project logo (optional): https://raw.githubusercontent.com/fexx301/pegshield/main/web/public/pegshield-mark.svg
- [ ] Add tags
- [ ] (If recorded) attach the demo video — script above
- [x] v4 claim settled 2026-09-12 — receipt already leads the table above
