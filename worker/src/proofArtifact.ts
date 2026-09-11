import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, type Hex } from "viem";
import { readDiscoveryLock } from "./discoveryLock.js";
import type { EncodableProof, ProofArtifact } from "./types.js";

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES_PATTERN = /^0x[0-9a-fA-F]*$/;
const DECIMAL_PATTERN = /^[0-9]+$/;
const SIGNED_DECIMAL_PATTERN = /^-?[0-9]+$/;

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

export function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/**
 * Returns the raw SDK sidecar path for a normalized artifact. The added
 * `.raw.json` segment is deliberate: it keeps the sidecar distinct for every
 * valid output name, including extensionless and multi-dot names.
 */
export function rawArtifactPath(outPath: string): string {
  const normalizedOutPath = resolve(outPath);
  const parsed = parse(normalizedOutPath);
  const candidate =
    parsed.ext.toLowerCase() === ".json"
      ? join(parsed.dir, `${parsed.name}.raw.json`)
      : `${normalizedOutPath}.raw.json`;
  if (resolve(candidate) === normalizedOutPath) {
    throw new Error("raw artifact sidecar path must differ from artifact path");
  }
  return candidate;
}

function assertSafeInteger(
  value: unknown,
  field: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
}

function assertHex(
  value: unknown,
  field: string,
  pattern: RegExp,
): asserts value is string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${field} must be canonical hex`);
  }
}

function assertArtifactShape(artifact: ProofArtifact): void {
  if (!artifact || artifact.version !== 1)
    throw new Error("unsupported proof artifact version");
  if (artifact.source.chainId !== 1 || artifact.source.chainKey !== 3) {
    throw new Error("proof artifact source chain is not pinned");
  }
  assertHex(
    artifact.source.transactionHash,
    "source.transactionHash",
    HASH_PATTERN,
  );
  assertSafeInteger(artifact.source.blockNumber, "source.blockNumber");
  assertSafeInteger(
    artifact.source.transactionIndex,
    "source.transactionIndex",
  );
  assertSafeInteger(
    artifact.source.rpcBlockLogIndex,
    "source.rpcBlockLogIndex",
  );
  assertSafeInteger(
    artifact.source.receiptLogPosition,
    "source.receiptLogPosition",
  );
  assertHex(artifact.source.emitter, "source.emitter", ADDRESS_PATTERN);

  const decoded = artifact.decodedExpected;
  if (!Array.isArray(decoded.topics) || decoded.topics.length !== 3) {
    throw new Error("decodedExpected.topics must contain exactly three topics");
  }
  assertHex(decoded.topic0, "decodedExpected.topic0", HASH_PATTERN);
  decoded.topics.forEach((topic, index) =>
    assertHex(topic, `decodedExpected.topics[${index}]`, HASH_PATTERN),
  );
  const firstTopic = decoded.topics[0];
  if (
    !firstTopic ||
    decoded.topic0.toLowerCase() !== firstTopic.toLowerCase()
  ) {
    throw new Error("decodedExpected.topic0 must equal topics[0]");
  }
  assertHex(decoded.data, "decodedExpected.data", /^0x[0-9a-fA-F]{64}$/);
  if (!DECIMAL_PATTERN.test(decoded.roundId)) {
    throw new Error(
      "decodedExpected.roundId must be an unsigned decimal string",
    );
  }
  if (!SIGNED_DECIMAL_PATTERN.test(decoded.answer)) {
    throw new Error("decodedExpected.answer must be a signed decimal string");
  }
  assertSafeInteger(decoded.updatedAt, "decodedExpected.updatedAt");
  if (decoded.receiptStatus !== "success") {
    throw new Error("decodedExpected.receiptStatus must be success");
  }

  const proof = artifact.proof;
  if (proof.sdkVersion !== "0.18.0" || proof.chainKey !== 3) {
    throw new Error("proof SDK or chain key is not pinned");
  }
  assertSafeInteger(proof.headerNumber, "proof.headerNumber");
  assertSafeInteger(proof.txIndex, "proof.txIndex");
  assertHex(proof.txHash, "proof.txHash", HASH_PATTERN);
  if (
    proof.txHash.toLowerCase() !== artifact.source.transactionHash.toLowerCase()
  ) {
    throw new Error("proof.txHash must equal source.transactionHash");
  }
  assertHex(proof.txBytes, "proof.txBytes", /^0x[0-9a-fA-F]+$/);
  assertHex(proof.merkleProof.root, "proof.merkleProof.root", HASH_PATTERN);
  proof.merkleProof.siblings.forEach((sibling, index) => {
    assertHex(
      sibling.hash,
      `proof.merkleProof.siblings[${index}].hash`,
      HASH_PATTERN,
    );
    if (typeof sibling.isLeft !== "boolean") {
      throw new Error(
        `proof.merkleProof.siblings[${index}].isLeft must be boolean`,
      );
    }
  });
  assertHex(
    proof.continuityProof.lowerEndpointDigest,
    "proof.continuityProof.lowerEndpointDigest",
    HASH_PATTERN,
  );
  proof.continuityProof.roots.forEach((root, index) =>
    assertHex(root, `proof.continuityProof.roots[${index}]`, HASH_PATTERN),
  );
  if (Number.isNaN(new Date(proof.generatedAt).getTime())) {
    throw new Error("proof.generatedAt must be an ISO timestamp");
  }
}

export function artifactPayload(
  artifact: ProofArtifact,
): Record<string, unknown> {
  return {
    source: artifact.source,
    decodedExpected: artifact.decodedExpected,
    proof: artifact.proof,
  };
}

export function proofFromArtifact(artifact: ProofArtifact): EncodableProof {
  return {
    chainKey: artifact.proof.chainKey,
    headerNumber: artifact.proof.headerNumber,
    txBytes: artifact.proof.txBytes,
    merkleProof: artifact.proof.merkleProof,
    continuityProof: artifact.proof.continuityProof,
  };
}

export function verifyArtifactIntegrity(artifact: ProofArtifact): {
  canonicalHash: string;
  normalized: boolean;
} {
  assertArtifactShape(artifact);
  const canonicalHash = sha256(canonicalize(artifactPayload(artifact)));
  if (canonicalHash !== artifact.integrity.canonicalJsonSha256) {
    throw new Error(
      `normalized proof checksum mismatch: expected ${artifact.integrity.canonicalJsonSha256}, got ${canonicalHash}`,
    );
  }
  return { canonicalHash, normalized: true };
}

export async function readProofArtifact(path: string): Promise<ProofArtifact> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as ProofArtifact;
  verifyArtifactIntegrity(parsed);
  const lock = await readDiscoveryLock(
    fileURLToPath(new URL("../../docs/discovery-lock.json", import.meta.url)),
  );
  if (
    parsed.source.emitter.toLowerCase() !==
      lock.networks.ethereum.underlyingAggregator.toLowerCase() ||
    parsed.decodedExpected.topic0.toLowerCase() !==
      lock.networks.ethereum.answerUpdatedTopic0.toLowerCase()
  ) {
    throw new Error("proof artifact source does not match the discovery lock");
  }
  const raw = JSON.parse(
    await readFile(rawArtifactPath(path), "utf8"),
  ) as unknown;
  const rawHash = sha256(canonicalize(raw));
  if (rawHash !== parsed.integrity.rawSdkJsonSha256) {
    throw new Error(
      `raw SDK artifact checksum mismatch: expected ${parsed.integrity.rawSdkJsonSha256}, got ${rawHash}`,
    );
  }
  return parsed;
}

export function encodedProofDigest(encoded: Hex): Hex {
  return keccak256(encoded);
}
