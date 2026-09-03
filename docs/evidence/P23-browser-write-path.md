# P23 — Browser write-path implementation

Status: **PASS — live wallet rehearsal complete**

The dashboard now exposes the missing G7 write boundary without moving private
keys or proof generation into the browser:

- the purchase form reads the pool-selected payout token, exact `quotePremium`,
  wallet balance, and allowance;
- an insufficient allowance produces an exact-premium ERC-20 `approve` request;
- after the approval receipt, the same form requires a passing CC3
  `buyPolicy` simulation before the wallet can submit the purchase;
- a receipt refreshes `nextPolicyId`, the selected policy, token reads, and the
  shareable `?policy=<id>` URL;
- the claim panel accepts only a bounded normalized worker artifact and checks
  the pinned Ethereum aggregator/topic, receipt success, SDK/chain, proof shape,
  and canonical SHA-256;
- the selected policy state chooses breach vs confirmation, then CC3 simulation
  and gas estimation gate the wallet write with 120% gas headroom;
- receipt success refreshes policy/accounting reads and exposes the CC3 claim
  transaction hash; simulation or validation failures remain inline and no
  transaction is submitted.

## Rehearsal boundary

The clean Chromium suite passed twice after these controls were added. P24
records the exact-premium approval and a browser-created fresh policy. P25
records two fresh worker artifacts after policy 2 started, both browser-side
validation/simulations, and successful breach then confirmation proofs from the
connected browser context. Policy 1 and the historical fixture were not reused
for this rehearsal.
