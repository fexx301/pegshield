# P14 — Shared read model and frontend data layer

Status: **PARTIAL — live deployment manifest pending**

The web package now has one CC3 chain definition, one Wagmi provider, and a
full pool ABI for capital, product terms, quote premium, and policy state.
When `NEXT_PUBLIC_PEGSHIELD_POOL_ADDRESS` is configured, the dashboard reads
those values from CC3 without requiring a connected wallet and derives free
capacity from the chain values. Without that manifest the UI displays an
explicit “deployment manifest pending” state rather than inventing capital or
policy data. The purchase control is backed by Wagmi’s real
`useSimulateContract` call and remains disabled until all live prerequisites
exist.

The remaining P14 work is deployment-matched ABI/code-hash evidence and
custom-error mapping after P12 produces live addresses.
