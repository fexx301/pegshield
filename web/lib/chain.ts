import { defineChain } from "viem";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

export const CC3_TESTNET = defineChain({
  id: 102031,
  name: "Creditcoin CC3 testnet",
  nativeCurrency: { name: "Creditcoin", symbol: "CTC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.cc3-testnet.creditcoin.network"] },
  },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [CC3_TESTNET],
  connectors: [injected()],
  transports: { [CC3_TESTNET.id]: http() },
  ssr: true,
});

export const PEGSHIELD_POOL_ADDRESS = process.env
  .NEXT_PUBLIC_PEGSHIELD_POOL_ADDRESS as `0x${string}` | undefined;

export const POOL_READ_ABI = [
  {
    type: "function",
    name: "payoutToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "accountedCapital",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "reservedCapital",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "nextPolicyId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "quotePremium",
    stateMutability: "view",
    inputs: [
      { name: "productId", type: "uint256" },
      { name: "coverage", type: "uint256" },
    ],
    outputs: [{ name: "premium", type: "uint256" }],
  },
  {
    type: "function",
    name: "getProduct",
    stateMutability: "view",
    inputs: [{ name: "productId", type: "uint256" }],
    outputs: [
      {
        name: "product",
        type: "tuple",
        components: [
          { name: "chainKey", type: "uint256" },
          { name: "aggregator", type: "address" },
          { name: "feedDecimals", type: "uint8" },
          { name: "triggerBelow", type: "int256" },
          { name: "activationDelay", type: "uint64" },
          { name: "policyDuration", type: "uint64" },
          { name: "claimGracePeriod", type: "uint64" },
          { name: "minBreachDuration", type: "uint64" },
          { name: "premiumBps", type: "uint32" },
          { name: "maxCoveragePerPolicy", type: "uint256" },
          { name: "enabled", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getPolicy",
    stateMutability: "view",
    inputs: [{ name: "policyId", type: "uint256" }],
    outputs: [
      {
        name: "policy",
        type: "tuple",
        components: [
          { name: "productId", type: "uint256" },
          { name: "holder", type: "address" },
          { name: "beneficiary", type: "address" },
          { name: "coverage", type: "uint256" },
          { name: "premium", type: "uint256" },
          { name: "purchasedAt", type: "uint64" },
          { name: "startsAt", type: "uint64" },
          { name: "endsAt", type: "uint64" },
          { name: "firstBreachAt", type: "uint64" },
          { name: "firstRoundId", type: "uint256" },
          { name: "firstEventId", type: "bytes32" },
          { name: "state", type: "uint8" },
        ],
      },
    ],
  },
] as const;

export const POOL_WRITE_ABI = [
  {
    type: "function",
    name: "buyPolicy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "productId", type: "uint256" },
      { name: "coverage", type: "uint256" },
      { name: "beneficiary", type: "address" },
    ],
    outputs: [{ name: "policyId", type: "uint256" }],
  },
] as const;

export const CLAIM_WRITE_ABI = [
  {
    type: "function",
    name: "submitBreachProof",
    stateMutability: "nonpayable",
    inputs: [
      { name: "policyId", type: "uint256" },
      { name: "encodedProof", type: "bytes" },
      { name: "receiptLogPosition", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "submitConfirmationProof",
    stateMutability: "nonpayable",
    inputs: [
      { name: "policyId", type: "uint256" },
      { name: "encodedProof", type: "bytes" },
      { name: "receiptLogPosition", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export const ERC20_READ_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const ERC20_WRITE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;
