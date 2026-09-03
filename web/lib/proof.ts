import { encodeAbiParameters, keccak256, type Hex } from "viem";

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const SHA256_PATTERN = /^sha256:[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES_PATTERN = /^0x[0-9a-fA-F]+$/;
const DECIMAL_PATTERN = /^[0-9]+$/;
const SIGNED_DECIMAL_PATTERN = /^-?[0-9]+$/;

export const LOCKED_AGGREGATOR =
  "0xc9e1a09622afdb659913fefe800feae5dbbfe9d7" as const;
export const ANSWER_UPDATED_TOPIC =
  "0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f" as const;

export type ProofArtifact = {
  version: 1;
  source: {
    chainId: 1;
    chainKey: 3;
    transactionHash: `0x${string}`;
    blockNumber: number;
    transactionIndex: number;
    rpcBlockLogIndex: number;
    receiptLogPosition: number;
    emitter: `0x${string}`;
  };
  decodedExpected: {
    topic0: `0x${string}`;
    topics: `0x${string}`[];
    data: `0x${string}`;
    roundId: string;
    answer: string;
    updatedAt: number;
    receiptStatus: "success";
  };
  proof: {
    sdkVersion: "0.18.0";
    chainKey: 3;
    headerNumber: number;
    txIndex: number;
    txHash: `0x${string}`;
    txBytes: `0x${string}`;
    merkleProof: {
      root: `0x${string}`;
      siblings: { hash: `0x${string}`; isLeft: boolean }[];
    };
    continuityProof: {
      lowerEndpointDigest: `0x${string}`;
      roots: `0x${string}`[];
    };
    cached: boolean;
    generatedAt: string;
  };
  integrity: {
    canonicalJsonSha256: `sha256:${string}`;
    rawSdkJsonSha256: `sha256:${string}`;
  };
};

export const CLAIM_PROOF_PARAMETERS = [
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
] as const;

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertHex(value: unknown, field: string, pattern: RegExp): void {
  assert(
    typeof value === "string" && pattern.test(value),
    `${field} is invalid`,
  );
}

function assertSafeInteger(value: unknown, field: string): void {
  assert(
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    `${field} must be a non-negative safe integer`,
  );
}

function artifactPayload(artifact: ProofArtifact): Record<string, unknown> {
  return {
    source: artifact.source,
    decodedExpected: artifact.decodedExpected,
    proof: artifact.proof,
  };
}

async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("browser cryptography is unavailable");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return `sha256:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export async function validateProofArtifact(
  input: unknown,
): Promise<{ artifact: ProofArtifact; checksum: string }> {
  assert(
    input !== null && typeof input === "object",
    "artifact must be an object",
  );
  const artifact = input as Partial<ProofArtifact>;
  assert(artifact.version === 1, "unsupported proof artifact version");

  const source = artifact.source;
  assert(source !== undefined, "source is required");
  assert(
    source.chainId === 1 && source.chainKey === 3,
    "source chain is not pinned",
  );
  assertHex(source.transactionHash, "source.transactionHash", HASH_PATTERN);
  assertSafeInteger(source.blockNumber, "source.blockNumber");
  assertSafeInteger(source.transactionIndex, "source.transactionIndex");
  assertSafeInteger(source.rpcBlockLogIndex, "source.rpcBlockLogIndex");
  assertSafeInteger(source.receiptLogPosition, "source.receiptLogPosition");
  assertHex(source.emitter, "source.emitter", ADDRESS_PATTERN);
  assert(
    source.emitter.toLowerCase() === LOCKED_AGGREGATOR,
    "source emitter does not match the locked aggregator",
  );

  const decoded = artifact.decodedExpected;
  assert(decoded !== undefined, "decodedExpected is required");
  assert(
    Array.isArray(decoded.topics) && decoded.topics.length === 3,
    "three topics are required",
  );
  assertHex(decoded.topic0, "decodedExpected.topic0", HASH_PATTERN);
  decoded.topics.forEach((topic, index) =>
    assertHex(topic, `decodedExpected.topics[${index}]`, HASH_PATTERN),
  );
  assert(
    decoded.topic0.toLowerCase() === ANSWER_UPDATED_TOPIC,
    "event topic is not locked",
  );
  const firstTopic = decoded.topics[0];
  assert(firstTopic !== undefined, "decodedExpected.topics is incomplete");
  assert(
    decoded.topic0.toLowerCase() === firstTopic.toLowerCase(),
    "topic0 mismatch",
  );
  assertHex(decoded.data, "decodedExpected.data", /^0x[0-9a-fA-F]{64}$/);
  assert(
    typeof decoded.roundId === "string" &&
      DECIMAL_PATTERN.test(decoded.roundId),
    "roundId is invalid",
  );
  assert(
    typeof decoded.answer === "string" &&
      SIGNED_DECIMAL_PATTERN.test(decoded.answer),
    "answer is invalid",
  );
  assertSafeInteger(decoded.updatedAt, "decodedExpected.updatedAt");
  assert(
    decoded.receiptStatus === "success",
    "source receipt was not successful",
  );

  const proof = artifact.proof;
  assert(proof !== undefined, "proof is required");
  assert(
    proof.sdkVersion === "0.18.0" && proof.chainKey === 3,
    "proof SDK or chain key is not pinned",
  );
  assertSafeInteger(proof.headerNumber, "proof.headerNumber");
  assertSafeInteger(proof.txIndex, "proof.txIndex");
  assertHex(proof.txHash, "proof.txHash", HASH_PATTERN);
  assert(
    proof.txHash.toLowerCase() === source.transactionHash.toLowerCase(),
    "proof transaction hash mismatch",
  );
  assertHex(proof.txBytes, "proof.txBytes", BYTES_PATTERN);
  assertHex(proof.merkleProof?.root, "proof.merkleProof.root", HASH_PATTERN);
  assert(
    Array.isArray(proof.merkleProof?.siblings),
    "merkle siblings are required",
  );
  proof.merkleProof.siblings.forEach((sibling, index) => {
    assertHex(
      sibling.hash,
      `proof.merkleProof.siblings[${index}].hash`,
      HASH_PATTERN,
    );
    assert(
      typeof sibling.isLeft === "boolean",
      `proof.merkleProof.siblings[${index}].isLeft is invalid`,
    );
  });
  assertHex(
    proof.continuityProof?.lowerEndpointDigest,
    "proof.continuityProof.lowerEndpointDigest",
    HASH_PATTERN,
  );
  assert(
    Array.isArray(proof.continuityProof?.roots),
    "continuity roots are required",
  );
  proof.continuityProof.roots.forEach((root, index) =>
    assertHex(root, `proof.continuityProof.roots[${index}]`, HASH_PATTERN),
  );
  assert(
    typeof proof.generatedAt === "string" &&
      !Number.isNaN(Date.parse(proof.generatedAt)),
    "generatedAt is invalid",
  );
  assert(artifact.integrity !== undefined, "integrity is required");
  assert(
    typeof artifact.integrity.rawSdkJsonSha256 === "string" &&
      SHA256_PATTERN.test(artifact.integrity.rawSdkJsonSha256),
    "integrity.rawSdkJsonSha256 is invalid",
  );
  assert(
    typeof artifact.integrity.canonicalJsonSha256 === "string" &&
      SHA256_PATTERN.test(artifact.integrity.canonicalJsonSha256),
    "integrity.canonicalJsonSha256 is invalid",
  );
  assertHex(
    artifact.integrity.canonicalJsonSha256.replace(/^sha256:/, "0x"),
    "integrity.canonicalJsonSha256",
    HASH_PATTERN,
  );

  const typed = artifact as ProofArtifact;
  const checksum = await sha256(canonicalize(artifactPayload(typed)));
  assert(
    checksum === typed.integrity.canonicalJsonSha256,
    "normalized artifact checksum mismatch",
  );
  return { artifact: typed, checksum };
}

export function encodeProof(artifact: ProofArtifact): Hex {
  return encodeAbiParameters(CLAIM_PROOF_PARAMETERS, [
    BigInt(artifact.proof.chainKey),
    BigInt(artifact.proof.headerNumber),
    artifact.proof.txBytes,
    {
      root: artifact.proof.merkleProof.root,
      siblings: artifact.proof.merkleProof.siblings,
    },
    {
      lowerEndpointDigest: artifact.proof.continuityProof.lowerEndpointDigest,
      roots: artifact.proof.continuityProof.roots,
    },
  ]);
}

export function proofDigest(artifact: ProofArtifact): Hex {
  return keccak256(encodeProof(artifact));
}
