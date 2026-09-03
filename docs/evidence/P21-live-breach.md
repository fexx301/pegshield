# P21 — Live G4 breach observation

Status: **PASS — fresh source event authenticated and recorded on CC3; G5
confirmation remains pending**

## Source event

The locked Ethereum aggregator emitted a new qualifying `AnswerUpdated` event
after policy 1 started:

- transaction: `0x4ca2c30a7564b71143955df06f5584d68694940e86b96ae94d31edab80cccd18`;
- Ethereum block: `25,887,978`, transaction index `118`;
- block-global log index: `443`;
- receipt-local log position: `2`;
- round: `1167`;
- signed answer: `99,980,711` feed units;
- source timestamp: `1788332447` (`2026-09-02T07:00:47Z`);
- receipt status: `success`.

The answer is positive and below product 1's trigger of `100,989,675`, and the
source timestamp is inside the policy window (`1788306390`–`1788911190`).

## Proof and CC3 submission

The worker built and checksum-validated
`proofs/policy-1-breach.json` from the live receipt. Its normalized artifact
checksum is:

`sha256:2ece0c74e59d5968c2766224182280507faba926cd729bf14212bba4ffddb0dd`

The encoded proof digest is:

`0xd71af2a44ad02e108d2ff8ca590e82add7fae03dbc1a6b886895ed4bcf935bc0`

The v2 CC3 pool simulation succeeded. The dedicated estimator returned
`498779` gas before submission; the submission's final estimate was `483848`,
and the worker sent a `580618` gas limit (12,000 BPS headroom). The successful
breach transaction is:

`0x663be79b2aca5ddfb1f4b60cbf0806b54c4528238420aec68493feae2d40c50c`

It was mined in CC3 block `5416276` with `470302` gas used. The receipt emitted
`BreachObserved` with event ID
`0x98506c4971072df9be20989c3bc522cacd7aeae2ae2e99cd5d7b5b130ac4e601`.

## Resulting state

Policy 1 is now `BreachObserved` (state `1`), with first round `1167` and first
breach timestamp `1788332447`. Accounting remains `1,002,500,000` accounted
and `100,000,000` reserved; no payout has occurred.

G5 requires a distinct later qualifying event with a higher round and a source
timestamp at or after `1788332747` (five minutes after the first observation),
still before the policy end. A follow-up scan through Ethereum block `25888052`
found no such event yet.
