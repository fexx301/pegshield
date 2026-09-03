import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);
const { createPublicClient, http, keccak256 } = require(
  resolve(repoRoot, "worker/node_modules/viem/_cjs/index.js"),
);
const lock = JSON.parse(
  readFileSync(resolve(repoRoot, "docs/discovery-lock.json"), "utf8"),
);
const ETHEREUM_CHAIN_ID = 1;
const DEFAULT_RPC = "https://ethereum-rpc.publicnode.com";
const aggregator = lock.networks.ethereum.underlyingAggregator;
const rpcUrl = process.env.ETHEREUM_RPC_URL ?? DEFAULT_RPC;

const ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "description",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
];

function marginBps(argv) {
  const index = argv.indexOf("--margin-bps");
  const value = index < 0 ? "100" : argv[index + 1];
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 10_000) {
    throw new Error("--margin-bps must be an integer from 1 to 10000");
  }
  return parsed;
}

function decimalPrice(answer, decimals) {
  const negative = answer < 0n;
  const absolute = (negative ? -answer : answer)
    .toString()
    .padStart(decimals + 1, "0");
  const split = absolute.length - decimals;
  return `${negative ? "-" : ""}${absolute.slice(0, split)}.${absolute.slice(split)}`;
}

async function main() {
  const margin = marginBps(process.argv.slice(2));
  const client = createPublicClient({
    chain: {
      id: ETHEREUM_CHAIN_ID,
      name: "Ethereum mainnet",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    transport: http(rpcUrl),
  });
  if ((await client.getChainId()) !== ETHEREUM_CHAIN_ID) {
    throw new Error("Ethereum RPC chain ID mismatch");
  }
  const bytecode = await client.getBytecode({ address: aggregator });
  if (!bytecode || bytecode === "0x")
    throw new Error("pinned aggregator has no runtime code");
  const codeHash = keccak256(bytecode).toLowerCase();
  if (codeHash !== lock.networks.ethereum.aggregatorCodeHash.toLowerCase()) {
    throw new Error("pinned aggregator code hash differs from discovery lock");
  }
  const [decimals, description, latest] = await Promise.all([
    client.readContract({
      address: aggregator,
      abi: ABI,
      functionName: "decimals",
    }),
    client.readContract({
      address: aggregator,
      abi: ABI,
      functionName: "description",
    }),
    client.readContract({
      address: aggregator,
      abi: ABI,
      functionName: "latestRoundData",
    }),
  ]);
  const [roundId, rawAnswer, , updatedAt] = latest;
  const answer = BigInt(rawAnswer);
  if (answer <= 0n) throw new Error("current source answer is not positive");
  const basis = 10_000n;
  const triggerBelow = answer + (answer * BigInt(margin) + basis - 1n) / basis;
  console.log(
    JSON.stringify(
      {
        ok: true,
        aggregator,
        description,
        decimals,
        roundId: roundId.toString(),
        updatedAt: updatedAt.toString(),
        currentAnswer: answer.toString(),
        currentPrice: decimalPrice(answer, decimals),
        marginBps: margin,
        triggerBelow: triggerBelow.toString(),
        triggerPrice: decimalPrice(triggerBelow, decimals),
        envLine: `DEMO_TRIGGER_BELOW=${triggerBelow.toString()}`,
        warning:
          "This is intentionally permissive testnet configuration; it is not a production depeg threshold.",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "trigger derivation failed",
  );
  process.exitCode = 1;
});
