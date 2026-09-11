import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  http,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { loadConfig } from "./config.js";
import { readDiscoveryLock } from "./discoveryLock.js";
import { WorkerError } from "./errors.js";

const ETHEREUM_CHAIN = {
  id: 1,
  name: "Ethereum mainnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://ethereum-rpc.publicnode.com"] } },
} as const;

const ANSWER_UPDATED_EVENT = {
  type: "event",
  name: "AnswerUpdated",
  inputs: [
    { name: "current", type: "int256", indexed: true },
    { name: "roundId", type: "uint256", indexed: true },
    { name: "updatedAt", type: "uint256", indexed: false },
  ],
} as const;

export type AnswerUpdatedEvent = {
  transactionHash: Hash;
  blockNumber: number;
  rpcBlockLogIndex: number;
  receiptLogPosition: number;
  emitter: Address;
  answer: string;
  roundId: string;
  updatedAt: number;
  receiptStatus: "success";
};

type RawLog = {
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  transactionHash?: Hash;
  blockNumber?: bigint | number;
  logIndex?: bigint | number;
};

function safeNumber(value: bigint | number, field: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new WorkerError(
      "PROOF_INVALID",
      `${field} is outside the safe integer range`,
    );
  }
  return result;
}

function signedTopic(topic: Hex): bigint {
  const value = BigInt(topic);
  return value >= 1n << 255n ? value - (1n << 256n) : value;
}

export function decodeAnswerUpdatedLog(
  log: RawLog,
  expectedEmitter: Address,
  expectedTopic0: Hex,
): Omit<AnswerUpdatedEvent, "receiptLogPosition" | "receiptStatus"> {
  if (log.address.toLowerCase() !== expectedEmitter.toLowerCase()) {
    throw new WorkerError(
      "PROOF_INVALID",
      "log emitter does not match the locked aggregator",
    );
  }
  if (
    log.topics.length !== 3 ||
    log.topics[0]?.toLowerCase() !== expectedTopic0.toLowerCase() ||
    !log.topics[1] ||
    !log.topics[2] ||
    !/^0x[0-9a-fA-F]{64}$/.test(log.data)
  ) {
    throw new WorkerError(
      "PROOF_INVALID",
      "log does not match AnswerUpdated shape",
    );
  }
  if (
    !log.transactionHash ||
    log.blockNumber === undefined ||
    log.logIndex === undefined
  ) {
    throw new WorkerError(
      "PROOF_INVALID",
      "log is missing source identity fields",
    );
  }
  return {
    transactionHash: log.transactionHash,
    blockNumber: safeNumber(log.blockNumber, "blockNumber"),
    rpcBlockLogIndex: safeNumber(log.logIndex, "logIndex"),
    emitter: log.address,
    answer: signedTopic(log.topics[1]).toString(),
    roundId: BigInt(log.topics[2]).toString(),
    updatedAt: safeNumber(BigInt(log.data), "updatedAt"),
  };
}

export async function scanAnswerUpdatedEvents(options: {
  fromBlock: number;
  toBlock: number;
  triggerBelow?: bigint;
}): Promise<AnswerUpdatedEvent[]> {
  if (
    !Number.isSafeInteger(options.fromBlock) ||
    !Number.isSafeInteger(options.toBlock) ||
    options.fromBlock < 0 ||
    options.toBlock < options.fromBlock ||
    options.toBlock - options.fromBlock > 10_000
  ) {
    throw new WorkerError(
      "PROOF_INVALID",
      "scan block range must be non-negative, ordered, and no larger than 10000 blocks",
    );
  }
  if (options.triggerBelow !== undefined && options.triggerBelow <= 0n) {
    throw new WorkerError("PROOF_INVALID", "triggerBelow must be positive");
  }
  const config = loadConfig();
  const lock = await readDiscoveryLock(
    fileURLToPath(new URL("../../docs/discovery-lock.json", import.meta.url)),
  );
  const client = createPublicClient({
    chain: {
      ...ETHEREUM_CHAIN,
      rpcUrls: {
        default: {
          http: [
            config.ethereumRpcUrl ?? ETHEREUM_CHAIN.rpcUrls.default.http[0],
          ],
        },
      },
    },
    transport: http(
      config.ethereumRpcUrl ?? ETHEREUM_CHAIN.rpcUrls.default.http[0],
    ),
  });
  const logs = await client.getLogs({
    address: lock.networks.ethereum.underlyingAggregator,
    event: ANSWER_UPDATED_EVENT,
    fromBlock: BigInt(options.fromBlock),
    toBlock: BigInt(options.toBlock),
  } as never);
  const events: AnswerUpdatedEvent[] = [];
  for (const log of logs) {
    const decoded = decodeAnswerUpdatedLog(
      log as unknown as RawLog,
      lock.networks.ethereum.underlyingAggregator,
      lock.networks.ethereum.answerUpdatedTopic0,
    );
    const answer = BigInt(decoded.answer);
    if (
      answer <= 0n ||
      (options.triggerBelow !== undefined && answer >= options.triggerBelow)
    ) {
      continue;
    }
    const receipt = await client.getTransactionReceipt({
      hash: decoded.transactionHash,
    });
    if (receipt.status !== "success") continue;
    const receiptLogPosition = receipt.logs.findIndex(
      (receiptLog) =>
        Number(receiptLog.logIndex) === decoded.rpcBlockLogIndex &&
        receiptLog.address.toLowerCase() === decoded.emitter.toLowerCase(),
    );
    if (receiptLogPosition < 0) {
      throw new WorkerError(
        "PROOF_INVALID",
        "source log was not found in its receipt",
      );
    }
    events.push({
      ...decoded,
      receiptLogPosition,
      receiptStatus: "success",
    });
  }
  return events;
}
