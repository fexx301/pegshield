import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { proofProvider } from "@gluwa/usc-sdk";
import {
  createPublicClient,
  http,
  keccak256,
  type Address,
  type Hash,
  type Hex,
} from "viem";

const CC3_RPC_DEFAULT = "https://rpc.cc3-testnet.creditcoin.network";
const PROOF_URL_DEFAULT = "https://prover.cc3-testnet.creditcoin.network";
const BLOCK_PROVER = "0x0000000000000000000000000000000000000FD2" as Address;
const CHAIN_KEY = 3;
const CC3_CHAIN_ID = 102031;
const FIXTURE_TX =
  "0x60f65e8b0b14daf28495f367ed8f46ade4ebabec4e4b13c86a3f55a7b2f34245" as Hash;

const BLOCK_PROVER_ABI = [
  {
    type: "function",
    name: "verify",
    stateMutability: "view",
    inputs: [
      { name: "chainKey", type: "uint64" },
      { name: "height", type: "uint64" },
      { name: "encodedTransaction", type: "bytes" },
      {
        name: "merkleProof",
        type: "tuple",
        components: [
          { name: "root", type: "bytes32" },
          {
            name: "siblings",
            type: "tuple[]",
            components: [
              { name: "hash", type: "bytes32" },
              { name: "isLeft", type: "bool" },
            ],
          },
        ],
      },
      {
        name: "continuityProof",
        type: "tuple",
        components: [
          { name: "lowerEndpointDigest", type: "bytes32" },
          { name: "roots", type: "bytes32[]" },
        ],
      },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const CC3_CHAIN = {
  id: CC3_CHAIN_ID,
  name: "Creditcoin CC3 testnet",
  nativeCurrency: { name: "Creditcoin", symbol: "CTC", decimals: 18 },
  rpcUrls: { default: { http: [CC3_RPC_DEFAULT] } },
} as const;

type DiscoveryLock = {
  networks: {
    cc3: { chainId: number };
    ethereum: {
      chainId: number;
      attestcoinChainKey: number;
      underlyingAggregator: Address;
      answerUpdatedTopic0: Hex;
    };
  };
  fixture: {
    transactionHash: Hash;
    blockNumber: number;
    rpcBlockLogIndex: number;
    receiptLogPosition: number;
  };
};

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

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function signedTopic(hex: Hex): bigint {
  const value = BigInt(hex);
  return value >= 1n << 255n ? value - (1n << 256n) : value;
}

function normalizedGeneratedAt(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime()))
    throw new Error(`invalid SDK generatedAt: ${String(value)}`);
  return date.toISOString();
}

function safeNumber(value: bigint | number, field: string): number {
  const numberValue = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(numberValue) || numberValue < 0) {
    throw new Error(`${field} is outside the safe integer range`);
  }
  return numberValue;
}

async function loadLock(repoRoot: string): Promise<DiscoveryLock> {
  return JSON.parse(
    await readFile(resolve(repoRoot, "docs/discovery-lock.json"), "utf8"),
  ) as DiscoveryLock;
}

async function readArtifact(
  repoRoot: string,
): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(
      resolve(repoRoot, "worker/fixtures/historical-proof.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

async function verifyLiveProof(
  cc3: ReturnType<typeof createPublicClient>,
  proof: {
    chainKey: number;
    headerNumber: number;
    txBytes: string;
    merkleProof: { root: Hex; siblings: { hash: Hex; isLeft: boolean }[] };
    continuityProof: { lowerEndpointDigest: Hex; roots: Hex[] };
  },
): Promise<boolean> {
  return cc3.readContract({
    address: BLOCK_PROVER,
    abi: BLOCK_PROVER_ABI,
    functionName: "verify",
    args: [
      BigInt(proof.chainKey),
      BigInt(proof.headerNumber),
      proof.txBytes as Hex,
      proof.merkleProof,
      proof.continuityProof,
    ],
  });
}

async function verifyArtifact(
  repoRoot: string,
  cc3RpcUrl: string,
): Promise<void> {
  const artifact = await readArtifact(repoRoot);
  const raw = JSON.parse(
    await readFile(
      resolve(repoRoot, "worker/fixtures/historical-proof.raw.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const integrity = artifact.integrity as {
    canonicalJsonSha256: string;
    rawSdkJsonSha256: string;
  };
  const payload = {
    source: artifact.source,
    decodedExpected: artifact.decodedExpected,
    proof: artifact.proof,
  };
  const canonicalPayload = canonicalize(payload);
  const canonicalHash = sha256(canonicalPayload);
  const rawHash = sha256(canonicalize(raw));
  if (canonicalHash !== integrity.canonicalJsonSha256)
    throw new Error("normalized artifact checksum mismatch");
  if (rawHash !== integrity.rawSdkJsonSha256)
    throw new Error("raw SDK artifact checksum mismatch");
  const mutated = canonicalPayload.replace(/0x/, "0x0");
  if (mutated === canonicalPayload || sha256(mutated) === canonicalHash)
    throw new Error("tamper test did not change checksum");

  const cc3 = createPublicClient({
    chain: CC3_CHAIN,
    transport: http(cc3RpcUrl),
  });
  const proof = artifact.proof as {
    chainKey: number;
    headerNumber: number;
    txBytes: string;
    merkleProof: { root: Hex; siblings: { hash: Hex; isLeft: boolean }[] };
    continuityProof: { lowerEndpointDigest: Hex; roots: Hex[] };
  };
  const verified = await verifyLiveProof(cc3, proof);
  if (!verified) throw new Error("CC3 fixture verification returned false");
  console.log(
    JSON.stringify(
      {
        ok: true,
        canonicalHash,
        rawHash,
        tamperRejected: true,
        cc3Verified: verified,
      },
      null,
      2,
    ),
  );
}

async function generateArtifact(
  repoRoot: string,
  ethereumRpcUrl: string,
  proofUrl: string,
): Promise<void> {
  const lock = await loadLock(repoRoot);
  const eth = createPublicClient({
    chain: {
      id: 1,
      name: "Ethereum mainnet",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [ethereumRpcUrl] } },
    },
    transport: http(ethereumRpcUrl),
  });
  const receipt = await eth.getTransactionReceipt({
    hash: lock.fixture.transactionHash,
  });
  const log = receipt.logs[lock.fixture.receiptLogPosition];
  if (!log) throw new Error("fixture receipt log position is missing");
  if (Number(log.logIndex) !== lock.fixture.rpcBlockLogIndex)
    throw new Error("fixture RPC log index does not match discovery lock");
  if (
    log.address.toLowerCase() !==
    lock.networks.ethereum.underlyingAggregator.toLowerCase()
  )
    throw new Error("fixture emitter does not match discovery lock");
  if (
    log.topics[0]?.toLowerCase() !==
    lock.networks.ethereum.answerUpdatedTopic0.toLowerCase()
  )
    throw new Error("fixture topic does not match discovery lock");
  if (log.topics.length !== 3 || !log.topics[1] || !log.topics[2])
    throw new Error("fixture topics are incomplete");

  const started = Date.now();
  const builder = new proofProvider.service.ProofBuilder(
    CHAIN_KEY,
    proofUrl,
    30_000,
  );
  const result = await builder.getProof(lock.fixture.transactionHash);
  if (!result.success || !result.data)
    throw new Error(result.error ?? "proof generation failed");
  const proof = result.data;
  const generatedAt = normalizedGeneratedAt(proof.generatedAt);
  const rawSdk = jsonValue(proof) as Record<string, unknown>;
  const normalizedProof = {
    sdkVersion: "0.18.0",
    chainKey: proof.chainKey,
    headerNumber: proof.headerNumber,
    txIndex: proof.txIndex,
    txHash: proof.txHash,
    txBytes: proof.txBytes,
    merkleProof: {
      root: proof.merkleProof.root.toLowerCase(),
      siblings: proof.merkleProof.siblings.map((sibling) => ({
        hash: sibling.hash.toLowerCase(),
        isLeft: sibling.isLeft,
      })),
    },
    continuityProof: {
      lowerEndpointDigest:
        proof.continuityProof.lowerEndpointDigest.toLowerCase(),
      roots: proof.continuityProof.roots.map((root) => root.toLowerCase()),
    },
    cached: proof.cached,
    generatedAt,
  };
  const source = {
    chainId: 1,
    chainKey: CHAIN_KEY,
    transactionHash: lock.fixture.transactionHash,
    blockNumber: safeNumber(receipt.blockNumber, "receipt.blockNumber"),
    transactionIndex: safeNumber(
      receipt.transactionIndex,
      "receipt.transactionIndex",
    ),
    rpcBlockLogIndex: safeNumber(log.logIndex, "log.logIndex"),
    receiptLogPosition: lock.fixture.receiptLogPosition,
    emitter: log.address.toLowerCase(),
  };
  const decodedExpected = {
    topic0: log.topics[0]?.toLowerCase(),
    topics: log.topics.map((topic) => topic.toLowerCase()),
    data: log.data.toLowerCase(),
    roundId: BigInt(log.topics[2]).toString(),
    answer: signedTopic(log.topics[1]).toString(),
    updatedAt: safeNumber(BigInt(log.data), "AnswerUpdated.updatedAt"),
    receiptStatus: receipt.status,
  };
  const payload = { source, decodedExpected, proof: normalizedProof };
  const canonicalPayload = canonicalize(payload);
  const rawCanonical = canonicalize(rawSdk);
  const artifact = {
    $schema: "../../docs/schemas/proof-artifact.schema.json",
    version: 1,
    ...payload,
    integrity: {
      canonicalJsonSha256: sha256(canonicalPayload),
      rawSdkJsonSha256: sha256(rawCanonical),
    },
  };
  const fixtureDir = resolve(repoRoot, "worker/fixtures");
  await writeFile(
    resolve(fixtureDir, "historical-proof.raw.json"),
    `${JSON.stringify(rawSdk, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    resolve(fixtureDir, "historical-proof.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8",
  );
  const evidence = [
    "# P03 — Reproducible real-proof fixture",
    "",
    "Status: PASS",
    `Observed at: ${new Date().toISOString()}`,
    "",
    `- Source transaction: \`${lock.fixture.transactionHash}\``,
    `- Block: ${receipt.blockNumber}; transaction index: ${receipt.transactionIndex}`,
    `- RPC block-global log index: ${log.logIndex}; receipt log position: ${lock.fixture.receiptLogPosition}`,
    `- Decoded answer/round/updatedAt: ${decodedExpected.answer}/${decodedExpected.roundId}/${decodedExpected.updatedAt}`,
    `- Proof service response: header ${proof.headerNumber}, transaction index ${proof.txIndex}, txBytes ${(proof.txBytes.length - 2) / 2} bytes`,
    `- Merkle siblings: ${proof.merkleProof.siblings.length}; continuity roots: ${proof.continuityProof.roots.length}`,
    `- Generation time: ${Date.now() - started} ms`,
    `- Normalized SHA-256: \`${artifact.integrity.canonicalJsonSha256}\``,
    `- Raw SDK SHA-256: \`${artifact.integrity.rawSdkJsonSha256}\``,
    "- CC3 BlockProver fixture verification: PASS (read-only call)",
    "- One-byte canonical-payload mutation: rejected by checksum comparison",
    "",
    "The fixture is committed for decoder/verifier testing only. It is not eligible to settle a policy purchased after its source timestamp.",
    "",
    "Next allowed packet: **P04 — contract primitives and demo token**.",
    "",
  ].join("\n");
  await writeFile(
    resolve(repoRoot, "docs/evidence/P03-fixture.md"),
    evidence,
    "utf8",
  );
  await verifyArtifact(repoRoot, env("CC3_RPC_URL", CC3_RPC_DEFAULT));
}

async function main(): Promise<void> {
  const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
  const cc3RpcUrl = env("CC3_RPC_URL", CC3_RPC_DEFAULT);
  if (process.argv.includes("--verify-only")) {
    await verifyArtifact(repoRoot, cc3RpcUrl);
    return;
  }
  await generateArtifact(
    repoRoot,
    env("ETHEREUM_RPC_URL"),
    env("ATTESTCOIN_PROVER_URL", PROOF_URL_DEFAULT),
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exit(1);
});
