// Server-side only: fixed chain/feed endpoints, no wallet or signing credentials.
import { createHash } from "node:crypto";
import {
  createPublicClient,
  fallback,
  http,
  keccak256,
  parseAbiItem,
  toHex,
  type Hex,
} from "viem";
import { z } from "zod";
import { CC3_TESTNET, PEGSHIELD_POOL_ADDRESS, POOL_READ_ABI } from "./chain";
import {
  ANSWER_UPDATED_TOPIC,
  LOCKED_AGGREGATOR,
  canonicalize,
  validateProofArtifact,
  type ProofArtifact,
} from "./proof";
import { selectPair, type Eligibility, type Observation } from "./eligibility";

const PROVER = "https://prover.cc3-testnet.creditcoin.network";
const event = parseAbiItem(
  "event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)",
);
const hash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((v) => v as Hex);
const merkle = z.object({
  root: hash,
  siblings: z.array(z.object({ hash, isLeft: z.boolean() })).max(64),
});
const continuity = z.object({
  lowerEndpointDigest: hash,
  roots: z.array(hash).max(2048),
});
const batchSchema = z.object({
  chainKey: z.literal(3),
  generatedAt: z.string().datetime(),
  cached: z.boolean(),
  continuityProof: continuity,
  merkleProofs: z.record(
    z.record(
      z.object({
        txHash: hash,
        txBytes: z
          .string()
          .regex(/^0x(?:[a-fA-F0-9]{2})+$/)
          .max(131074)
          .transform((v) => v as Hex),
        merkleProof: merkle,
      }),
    ),
  ),
});
const singleSchema = z.object({
  chainKey: z.literal(3),
  generatedAt: z.string().datetime(),
  cached: z.boolean(),
  headerNumber: z.number().int().nonnegative(),
  txIndex: z.number().int().nonnegative(),
  txHash: hash,
  txBytes: z
    .string()
    .regex(/^0x(?:[a-fA-F0-9]{2})+$/)
    .max(131074)
    .transform((v) => v as Hex),
  merkleProof: merkle,
  continuityProof: continuity,
});
const digest = (value: unknown) =>
  `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}` as const;

export class PolicyNotFoundError extends Error {
  constructor() {
    super("Policy not found.");
    this.name = "PolicyNotFoundError";
  }
}

// Selector of the pool's UnknownPolicy(uint256) revert for unpurchased IDs.
const UNKNOWN_POLICY_SELECTOR = keccak256(
  toHex("UnknownPolicy(uint256)"),
).slice(0, 10);

function isUnknownPolicyRevert(error: unknown): boolean {
  // viem exposes the raw revert data on ContractFunctionRevertedError inside
  // the cause chain; match on it instead of parsing message text.
  let cause: unknown = error;
  let depth = 0;
  while (cause !== null && typeof cause === "object" && depth < 10) {
    if ("raw" in cause) {
      const raw = cause.raw;
      if (typeof raw === "string" && raw.startsWith(UNKNOWN_POLICY_SELECTOR))
        return true;
    }
    cause = "cause" in cause ? cause.cause : undefined;
    depth++;
  }
  return false;
}

async function json(url: string, signal: AbortSignal, body?: unknown) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { "content-type": "application/json" } : undefined,
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("upstream unavailable");
  // Bound streamed upstream responses before JSON parsing.
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty response");
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 512 * 1024) {
      await reader.cancel();
      throw new Error("response limit");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export async function discoverClaim(policyId: bigint, signal: AbortSignal) {
  if (!PEGSHIELD_POOL_ADDRESS) throw new Error("deployment unavailable");
  const cc3 = createPublicClient({
    chain: CC3_TESTNET,
    transport: http(undefined, {
      retryCount: 0,
      timeout: 10000,
      fetchOptions: { signal },
    }),
  });
  const eth = createPublicClient({
    transport: fallback(
      [
        ...(process.env.ETHEREUM_RPC_URL ? [process.env.ETHEREUM_RPC_URL] : []),
        "https://ethereum-rpc.publicnode.com",
        "https://eth.drpc.org",
      ].map((url) =>
        http(url, { retryCount: 0, timeout: 5000, fetchOptions: { signal } }),
      ),
      { retryCount: 0 },
    ),
  });
  const policy = await cc3
    .readContract({
      address: PEGSHIELD_POOL_ADDRESS,
      abi: POOL_READ_ABI,
      functionName: "getPolicy",
      args: [policyId],
    })
    .catch((error: unknown) => {
      // The pool reverts UnknownPolicy(uint256) for IDs that were never
      // purchased; that is a permanent miss, not a service failure.
      if (isUnknownPolicyRevert(error)) throw new PolicyNotFoundError();
      throw error;
    });
  // Unreachable on the current pool (it reverts first); this only guards a
  // pool that would return an empty struct instead.
  if (policy.productId === 0n) throw new PolicyNotFoundError();
  const product = await cc3.readContract({
    address: PEGSHIELD_POOL_ADDRESS,
    abi: POOL_READ_ABI,
    functionName: "getProduct",
    args: [policy.productId],
  });
  if (
    product.chainKey !== 3n ||
    product.aggregator.toLowerCase() !== LOCKED_AGGREGATOR
  )
    throw new Error("unsupported product");
  const now = (await cc3.getBlock()).timestamp;
  const result = (
    status: Eligibility["status"],
    observations: Observation[] = [],
  ): Eligibility => ({
    status,
    observations,
    checkedAt: new Date().toISOString(),
  });
  if (policy.state === 2) return { eligibility: result("claimed"), eth };
  if (policy.state === 3 || now > policy.endsAt + product.claimGracePeriod)
    return { eligibility: result("expired"), eth };
  if (now < policy.startsAt) return { eligibility: result("activation"), eth };
  const head = await eth.getBlock({ blockTag: "finalized" });
  // Locate coverage by timestamps, never by a guessed block-time conversion.
  let lo = 0n,
    hi = head.number;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const block = await eth.getBlock({ blockNumber: mid });
    if (block.timestamp < policy.startsAt) lo = mid + 1n;
    else hi = mid;
  }
  if (head.number - lo > 250000n)
    throw new Error("coverage scan exceeds automatic limit");
  // Locate the first block past the coverage end the same way, so the scan
  // below stops at the boundary without a block probe after every chunk.
  // No block before the start can be past the end (timestamps never
  // decrease).
  let end = lo,
    endHi = head.number + 1n;
  while (end < endHi) {
    const mid = (end + endHi) / 2n;
    const block = await eth.getBlock({ blockNumber: mid });
    if (block.timestamp > policy.endsAt) endHi = mid;
    else end = mid + 1n;
  }
  const scanEnd = end < head.number ? end : head.number;
  const observations: Observation[] = [];
  let pair: Observation[] = [];
  // Chunks that cross the coverage boundary are still fetched whole.
  for (let from = lo; from <= scanEnd; from += 1000n) {
    const to = from + 999n < head.number ? from + 999n : head.number;
    const logs = await eth.getLogs({
      address: LOCKED_AGGREGATOR,
      event,
      fromBlock: from,
      toBlock: to,
      strict: true,
    });
    for (const log of logs)
      observations.push({
        transactionHash: log.transactionHash,
        blockNumber: Number(log.blockNumber),
        answer: log.args.current.toString(),
        roundId: log.args.roundId.toString(),
        updatedAt: Number(log.args.updatedAt),
      });
    pair = selectPair(observations, { ...policy, ...product });
    if (pair.length === 2) break;
  }
  if (pair.length < 2)
    return {
      eligibility: result(
        now > policy.endsAt && head.timestamp >= policy.endsAt
          ? "closed"
          : pair.length
            ? "confirmation"
            : "first",
        pair,
      ),
      eth,
    };
  const height = z
    .object({ attestedHeight: z.number().int().nonnegative() })
    .parse(await json(`${PROVER}/api/v1/attested-height/3`, signal));
  return {
    eligibility: result(
      pair.every((e) => e.blockNumber <= height.attestedHeight)
        ? "eligible"
        : "attestation",
      pair,
    ),
    eth,
  };
}

export async function prepareClaim(policyId: bigint, signal: AbortSignal) {
  const { eligibility, eth } = await discoverClaim(policyId, signal);
  if (eligibility.status !== "eligible") return { eligibility };
  const pair = eligibility.observations;
  const first = pair[0]!,
    second = pair[1]!;
  // Batch generation refreshes the shared continuity anchor for nearby events.
  const batch =
    second.blockNumber - first.blockNumber <= 1000
      ? batchSchema.parse(
          await json(
            `${PROVER}/api/v1/proof-batch-by-tx/3`,
            signal,
            pair.map((e) => e.transactionHash),
          ),
        )
      : undefined;
  const artifacts: ProofArtifact[] = [];
  for (const observation of pair) {
    const receipt = await eth.getTransactionReceipt({
      hash: observation.transactionHash,
    });
    if (receipt.status !== "success") throw new Error("source reverted");
    if (
      receipt.transactionHash.toLowerCase() !==
        observation.transactionHash.toLowerCase() ||
      Number(receipt.blockNumber) !== observation.blockNumber
    )
      throw new Error("receipt identity mismatch");
    const position = receipt.logs.findIndex(
      (l) =>
        l.address.toLowerCase() === LOCKED_AGGREGATOR &&
        l.topics[0]?.toLowerCase() === ANSWER_UPDATED_TOPIC &&
        l.topics[1] &&
        BigInt(l.topics[1]).toString() === observation.answer &&
        l.topics[2] &&
        BigInt(l.topics[2]).toString() === observation.roundId &&
        l.data.length === 66 &&
        Number(BigInt(l.data)) === observation.updatedAt,
    );
    const log = receipt.logs[position];
    if (!log || log.topics.length !== 3) throw new Error("source mismatch");
    const currentBatch =
      batch ??
      batchSchema.parse(
        await json(`${PROVER}/api/v1/proof-batch-by-tx/3`, signal, [
          observation.transactionHash,
        ]),
      );
    const entry =
      currentBatch.merkleProofs[String(receipt.blockNumber)]?.[
        String(receipt.transactionIndex)
      ];
    const proof = {
      ...entry,
      chainKey: currentBatch.chainKey,
      continuityProof: currentBatch.continuityProof,
      generatedAt: currentBatch.generatedAt,
      cached: currentBatch.cached,
      headerNumber: Number(receipt.blockNumber),
      txIndex: receipt.transactionIndex,
    };
    const normalized = singleSchema.parse(proof);
    // The batch entries expose no header number of their own, so the prover's
    // anchor cannot be cross-checked here; the receipt's block number is used
    // directly when the proof is assembled above.
    if (
      normalized.txHash.toLowerCase() !==
        observation.transactionHash.toLowerCase() ||
      normalized.txIndex !== receipt.transactionIndex
    )
      throw new Error("proof identity mismatch");
    const payload = {
      source: {
        chainId: 1 as const,
        chainKey: 3 as const,
        transactionHash: observation.transactionHash,
        blockNumber: Number(receipt.blockNumber),
        transactionIndex: receipt.transactionIndex,
        rpcBlockLogIndex: log.logIndex,
        receiptLogPosition: position,
        emitter: log.address,
      },
      decodedExpected: {
        topic0: ANSWER_UPDATED_TOPIC,
        topics: [...log.topics],
        data: log.data,
        roundId: observation.roundId,
        answer: observation.answer,
        updatedAt: observation.updatedAt,
        receiptStatus: "success" as const,
      },
      proof: { ...normalized, sdkVersion: "0.18.0" as const },
    };
    const artifact: ProofArtifact = {
      version: 1,
      ...payload,
      integrity: {
        canonicalJsonSha256: digest(payload),
        // Digest the raw SDK batch entry as received, matching the worker's
        // meaning for this field name.
        rawSdkJsonSha256: digest(entry),
      },
    };
    artifacts.push((await validateProofArtifact(artifact)).artifact);
  }
  return { eligibility, artifacts };
}
