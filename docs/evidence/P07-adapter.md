# P07 — Attestcoin verifier adapter

Status: **REVIEW / fresh live claim pending**

## Implemented boundary

- `AttestcoinVerifierAdapter` is the only production contract that knows the
  discovered Attestcoin tuple `(chainKey, height, encodedTransaction,
merkleProof, continuityProof)`.
- The pool accepts only opaque proof bytes and a receipt-local log position.
- The adapter calls the pinned BlockProver, checks the EVM-v1 transaction type
  and exact chunk count, decodes the final receipt chunk, and returns only the
  authenticated log envelope.
- `VerifiedSourceLog.attestedTransactionDigest` is explicitly the
  `keccak256` digest of the authenticated encoded transaction. It is not
  misrepresented as an Ethereum RPC transaction hash.
- The pure Chainlink decoder enforces the locked `AnswerUpdated` topic,
  three-topic layout, 32-byte data, signed `int256` answer, and domain-separated
  event IDs.

## Offline verification evidence

```text
forge test --root contracts --match-path 'test/AttestcoinVerifierAdapter.t.sol' -vvv
14 passed; 0 failed
```

The tests cover dependency pinning, valid synthetic proof flow, receipt-log
bounds, failed receipt status, transaction/Merkle/continuity mutation,
truncation, wrong chain/type, decoder validity, signed answer decoding,
domain-separated event IDs, wrong topic, malformed logs, and receipt-chunk
selection across all five supported EVM-v1 transaction types.

## Review notes and remaining gate

The synthetic decoder mock is intentionally isolated under
`contracts/test/mocks`. It proves the adapter boundary and mutation behavior,
but it is not evidence that a deployed adapter has completed the full CC3 call.
The live BlockProver fixture verification is proven independently in P03, and
the deployed adapter address/runtime hash are recorded in the validated P11
manifest. A fresh post-purchase claim still needs a newly observed qualifying
Ethereum receipt, independent receipt decoding, and live CC3 gas measurement.
