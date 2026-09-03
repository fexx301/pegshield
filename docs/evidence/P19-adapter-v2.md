# P19 — Live decoder-compatible adapter

Status: **PASS — adapter-only compatibility probe; not a policy claim**

Observed on CC3 testnet after the adapter decoder-input correction.

## Decoder matrix

Using `worker/fixtures/historical-proof.json` and the pinned CC3 decoder
`0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f`:

- `getTransactionType(fullEncodedTransaction)` returned `2`.
- `isValidTransactionType(2)` returned `true`.
- `decodeTransactionType2(fullEncodedTransaction)` succeeded.
- `decodeReceiptFields(finalReceiptChunk)` reverted.
- `decodeReceiptFields(fullEncodedTransaction)` succeeded and returned the
  expected receipt log at receipt-local position `2`.

## Corrected adapter probe

The corrected adapter was deployed independently at:

`0x11Ba097E105cbf8A48f4507FA2B9340A4d7fF30B`

Deployment transaction:

`0x8b0bfc7b00404389e2cdce6ff01bffdb12eb8dfc82f3863613bdba0565875159`

The read-only `verifySourceLog` call returned:

- chain key `3`;
- receipt-local position `2`;
- emitter `0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7`;
- exactly three topics with the locked `AnswerUpdated` topic0;
- the expected round, answer, and source timestamp;
- `receiptSucceeded = true`.

Negative probes also passed:

- position `3` reverted with `ReceiptLogOutOfBounds`;
- a one-byte authenticated transaction mutation reverted at BlockProver with
  `Merkle proof validation failed`.

The historical proof remains compatibility evidence only. It is not eligible
for G4/G5 because its source timestamp predates the new policy window.
