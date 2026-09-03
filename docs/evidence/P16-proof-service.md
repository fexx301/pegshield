# P16 — Operator and proof-service API

Status: **PASS for bounded proof endpoint and claim-command wiring / live deployment submit pending**

`worker/src/server.ts` exposes only `POST /api/proofs` and never accepts an
upstream URL, target pool, recipient, threshold, answer, or arbitrary proof.
It validates a 32-byte Ethereum transaction hash and bounded receipt-local log
position, caps request bodies, rate-limits by the socket peer (or a forwarded
identity only when the peer is explicitly trusted), de-duplicates in-flight
requests, caches successful artifacts for five minutes, and maps
source-not-found/source-ineligible/upstream failures to stable HTTP errors.
Upstream credentials and RPC URLs are never written to responses or logs.

```text
pnpm --filter @pegshield/worker typecheck
pnpm --filter @pegshield/worker test
 21 passed; 0 failed
```

The endpoint uses the typed proof builder and therefore rechecks the locked
aggregator/topic before calling the official SDK. The CLI now has exact
stage-specific CC3 simulation and submission paths; they fail closed until a
validated deployment manifest and (for submission) a locally configured
relayer key exist.
