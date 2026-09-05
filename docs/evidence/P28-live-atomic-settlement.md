# P28 — Live v3 atomic settlement

Status: **PASS**

Policy 1 on the v3 PegShield pool completed the hardened atomic claim path on
Creditcoin CC3 testnet. One transaction authenticated two distinct Ethereum
USDC/USD `AnswerUpdated` receipts, enforced the policy predicate, released the
reserve, and paid the beneficiary fixed at purchase.

## Source observations

| Field                | First observation                                                    | Confirmation                                                         |
| -------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Round                | `1171`                                                               | `1172`                                                               |
| Answer (8 decimals)  | `99985000`                                                           | `99979000`                                                           |
| `updatedAt`          | `1788505259`                                                         | `1788508823`                                                         |
| Ethereum block       | `25902321`                                                           | `25902618`                                                           |
| Receipt log position | `2`                                                                  | `2`                                                                  |
| Transaction          | `0x4876a2e3b835394a51fcab498775821df3c29e817481a890cba24a10a7ae9e32` | `0x53bb235fb9f71f983e1d602eaedd9a834e153783e50828b23b65750540c451b9` |

Both answers are below product 1's demo threshold `100989675`. Both timestamps
are inside policy 1's coverage window, and the `4564`-second separation exceeds
the required `300` seconds.

Immediately before submission, the normalized artifacts had integrity digests:

- first: `sha256:4ee729d3bac4902a4069bf00be10b2526da84f9032601b02e586adc11314ba0a`;
- confirmation:
  `sha256:fc9b6064efae582719805a6cf36659996b8586605f4725dddbc4b175f59ae843`.

## Simulation and transaction

The final read-only simulation passed with estimated gas `875035`, a worker gas
limit of `1050042`, calldata size `25988` bytes, and calldata digest
`0xd42240b30abac9a7b79a8b0a1178891aa47369a621dcb58d45441e0094aa6db8`.

- CC3 claim transaction:
  `0xc509b3577ebd9cbe3bc65d515e46d90ee88e58a0c97bdf43ae35c338b8ababb5`;
- block: `5434173`;
- status: success;
- gas used: `835156`.

Blockscout decodes the transaction's ERC-20 transfer as exactly `100000000`
six-decimal tUSD from the v3 pool to policy 1's stored beneficiary.

## Post-state reconciliation

- policy state: `Claimed` (`2`);
- stored first round: `1171`;
- stored first timestamp: `1788505259`;
- reserved capital: `500000000`, down exactly `100000000`;
- accounted capital: `915000000`, down exactly `100000000`;
- policies 2–6 remain reserved backup policies.

Public receipt:
`https://creditcoin-testnet.blockscout.com/tx/0xc509b3577ebd9cbe3bc65d515e46d90ee88e58a0c97bdf43ae35c338b8ababb5`.
