# P02 — Live integration discovery

Status: PASS for discovery and read-only fixture verification
Original discovery: 2026-09-01T16:19:09.642Z; aggregator runtime recheck:
2026-09-01T19:14:00Z

## Verified values

- CC3 chain ID: **102031**; latest queried block: **5412703**.
- Ethereum chain ID: **1**.
- USDC/USD proxy: **0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6**.
- Underlying event emitter: **0xc9E1a09622afdB659913fefE800fEaE5DBbFe9d7**; live code hash rechecked at **2026-09-01T19:14:00Z**: **0x16f41184f797cb8f8918680df0ebf2a97cc3192aa6b104615f61096fc674f2aa**.
- Feed: **USDC / USD**, decimals **8**.
- `AnswerUpdated` topic0: **0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f**.
- Fixture RPC block-global log index: **516**; receipt log position: **2**.
- Fixture decoded answer/round/time: **99989777/1166/1788249611**.
- Decoder candidate **0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f** accepts `getTransactionType` for the fixture and returns type **2**.
- BlockProver `verify` returns **true** for the real proof.
- Proof service attested height for chain key 3: **25883540**.

## SDK facts

- Entrypoint: `proofProvider.service.ProofBuilder`.
- Constructor: `new ProofBuilder(chainKey, builderUrl, timeout?)`.
- Proof method: `getProof(transactionHash) -> Promise<ProofResult>`.
- Response fields: `chainKey`, `headerNumber`, `txIndex`, `txHash`, `txBytes`, `merkleProof`, `continuityProof`, `cached`, `generatedAt`.
- BlockProver call: `verify(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[])) returns (bool)`.
- Proof service route: `/api/v1/proof-by-tx/{chainKey}/{transactionHash}`.

## Evidence

Full machine-readable evidence is in `docs/discovery-lock.json`. The historical fixture is valid for decoder/proof testing only; it is not a policy claim event.

Next allowed packet: **P03 — reproducible real-proof fixture**.
