import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { proofProvider } from "@gluwa/usc-sdk";
import {
  createPublicClient,
  http,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import {
  ATTESTCOIN_CHAIN_KEY,
  DEFAULT_PROOF_SERVICE_URL,
  loadConfig,
} from "./config.js";
import { readDiscoveryLock } from "./discoveryLock.js";
import { WorkerError } from "./errors.js";
import { canonicalize, sha256 } from "./proofArtifact.js";
import { rawArtifactPath } from "./proofArtifact.js";
import type { ProofArtifact } from "./types.js";

const ETHEREUM_CHAIN = {
  id: 1,
  name: "Ethereum mainnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://ethereum-rpc.publicnode.com"] } },
} as const;

function jsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonValue(item)]),
    );
  }
  return value;
}

function signedTopic(topic: Hex): string {
  const value = BigInt(topic);
  return (value >= 1n << 255n ? value - (1n << 256n) : value).toString();
}

function normalizeGeneratedAt(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime()))
    throw new Error("SDK returned an invalid generatedAt");
  return date.toISOString();
}

function safeNumber(value: bigint | number, field: string): number {
  const numberValue = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(numberValue) || numberValue < 0) {
    throw new Error(`${field} is outside the safe integer range`);
  }
  return numberValue;
}

export async function buildProofArtifact(options: {
  transactionHash: Hash;
  receiptLogPosition: number;
  outPath: string;
}): Promise<{ artifact: ProofArtifact; proofPath: string; rawPath: string }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(options.transactionHash)) {
    throw new WorkerError(
      "PROOF_INVALID",
      "transactionHash must be a 32-byte hex hash",
    );
  }
  if (
    !Number.isSafeInteger(options.receiptLogPosition) ||
    options.receiptLogPosition < 0
  ) {
    throw new WorkerError(
      "PROOF_INVALID",
      "receiptLogPosition must be a non-negative integer",
    );
  }

  const config = loadConfig();
  const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const lock = await readDiscoveryLock(`${repoRoot}/docs/discovery-lock.json`);
  const ethereumRpcUrl = config.ethereumRpcUrl;
  if (!ethereumRpcUrl)
    throw new Error("ETHEREUM_RPC_URL is required for proof build");
  const eth = createPublicClient({
    chain: {
      ...ETHEREUM_CHAIN,
      rpcUrls: { default: { http: [ethereumRpcUrl] } },
    },
    transport: http(ethereumRpcUrl),
  });
  const receipt = await eth.getTransactionReceipt({
    hash: options.transactionHash,
  });
  if (receipt.status !== "success")
    throw new WorkerError(
      "SOURCE_INELIGIBLE",
      `source receipt status is ${receipt.status}`,
    );
  const log = receipt.logs[options.receiptLogPosition];
  if (!log)
    throw new WorkerError(
      "SOURCE_NOT_FOUND",
      "receiptLogPosition is outside the receipt",
    );
  if (
    log.address.toLowerCase() !==
    lock.networks.ethereum.underlyingAggregator.toLowerCase()
  ) {
    throw new WorkerError(
      "SOURCE_INELIGIBLE",
      "receipt log emitter does not match the locked aggregator",
    );
  }
  if (
    log.topics[0]?.toLowerCase() !==
    lock.networks.ethereum.answerUpdatedTopic0.toLowerCase()
  ) {
    throw new WorkerError(
      "SOURCE_INELIGIBLE",
      "receipt log topic does not match AnswerUpdated",
    );
  }
  if (
    log.topics.length !== 3 ||
    !log.topics[1] ||
    !log.topics[2] ||
    log.data.length !== 66
  ) {
    throw new WorkerError(
      "SOURCE_INELIGIBLE",
      "locked AnswerUpdated log shape is malformed",
    );
  }
  const receiptBlockNumber = safeNumber(
    receipt.blockNumber,
    "receipt.blockNumber",
  );
  const receiptTransactionIndex = safeNumber(
    receipt.transactionIndex,
    "receipt.transactionIndex",
  );
  const rpcBlockLogIndex = safeNumber(log.logIndex, "log.logIndex");
  const updatedAt = safeNumber(BigInt(log.data), "AnswerUpdated.updatedAt");

  const proofServiceUrl = config.proofServiceUrl || DEFAULT_PROOF_SERVICE_URL;
  const builder = new proofProvider.service.ProofBuilder(
    ATTESTCOIN_CHAIN_KEY,
    proofServiceUrl,
    config.requestTimeoutMs,
  );
  const result = await builder.getProof(options.transactionHash);
  if (!result.success || !result.data)
    throw new WorkerError(
      "PROOF_SERVICE_FAILED",
      result.error ?? "proof generation failed",
      { retryable: true },
    );
  const proof = result.data;
  if (proof.chainKey !== ATTESTCOIN_CHAIN_KEY) {
    throw new WorkerError(
      "SOURCE_INELIGIBLE",
      `proof chain key ${proof.chainKey} does not match locked key ${ATTESTCOIN_CHAIN_KEY}`,
    );
  }
  if (proof.txHash.toLowerCase() !== options.transactionHash.toLowerCase()) {
    throw new WorkerError(
      "SOURCE_INELIGIBLE",
      "proof service returned a different transaction hash",
    );
  }
  if (proof.headerNumber !== receiptBlockNumber) {
    throw new WorkerError(
      "SOURCE_INELIGIBLE",
      "proof header does not match the Ethereum receipt block",
    );
  }
  if (proof.txIndex !== receiptTransactionIndex) {
    throw new WorkerError(
      "SOURCE_INELIGIBLE",
      "proof transaction index does not match the Ethereum receipt",
    );
  }
  const raw = jsonValue(proof) as Record<string, unknown>;
  const normalizedProof = {
    sdkVersion: "0.18.0" as const,
    chainKey: proof.chainKey as 3,
    headerNumber: proof.headerNumber,
    txIndex: proof.txIndex,
    txHash: proof.txHash.toLowerCase() as Hash,
    txBytes: proof.txBytes.toLowerCase() as Hex,
    merkleProof: {
      root: proof.merkleProof.root.toLowerCase() as Hex,
      siblings: proof.merkleProof.siblings.map((sibling) => ({
        hash: sibling.hash.toLowerCase() as Hex,
        isLeft: sibling.isLeft,
      })),
    },
    continuityProof: {
      lowerEndpointDigest:
        proof.continuityProof.lowerEndpointDigest.toLowerCase() as Hex,
      roots: proof.continuityProof.roots.map(
        (root) => root.toLowerCase() as Hex,
      ),
    },
    cached: proof.cached,
    generatedAt: normalizeGeneratedAt(proof.generatedAt),
  };
  const source = {
    chainId: 1 as const,
    chainKey: ATTESTCOIN_CHAIN_KEY as 3,
    transactionHash: options.transactionHash.toLowerCase() as Hash,
    blockNumber: receiptBlockNumber,
    transactionIndex: receiptTransactionIndex,
    rpcBlockLogIndex,
    receiptLogPosition: options.receiptLogPosition,
    emitter: log.address.toLowerCase() as Address,
  };
  const decodedExpected = {
    topic0: log.topics[0].toLowerCase() as Hex,
    topics: log.topics.map((topic) => topic.toLowerCase() as Hex),
    data: log.data.toLowerCase() as Hex,
    roundId: BigInt(log.topics[2]).toString(),
    answer: signedTopic(log.topics[1]),
    updatedAt,
    receiptStatus: "success" as const,
  };
  const payload = { source, decodedExpected, proof: normalizedProof };
  const artifact = {
    $schema: "../../docs/schemas/proof-artifact.schema.json" as const,
    version: 1 as const,
    ...payload,
    integrity: {
      canonicalJsonSha256: sha256(canonicalize(payload)),
      rawSdkJsonSha256: sha256(canonicalize(raw)),
    },
  } satisfies ProofArtifact;
  await mkdir(dirname(options.outPath), { recursive: true });
  await writeFile(
    options.outPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8",
  );
  const rawPath = rawArtifactPath(options.outPath);
  await writeFile(rawPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return { artifact, proofPath: options.outPath, rawPath };
}
