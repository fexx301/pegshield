import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildClaimCall,
  claimArtifactDigest,
  claimFunctionName,
  parsePolicyId,
} from "../src/cc3Client.js";
import { loadConfig } from "../src/config.js";
import { validateDiscoveryLock } from "../src/discoveryLock.js";
import { WorkerError } from "../src/errors.js";
import {
  canonicalize,
  proofFromArtifact,
  rawArtifactPath,
  readProofArtifact,
  verifyArtifactIntegrity,
} from "../src/proofArtifact.js";
import {
  decodeAttestcoinProof,
  encodeAttestcoinProof,
} from "../src/proofEncoder.js";
import type { ProofArtifact } from "../src/types.js";

const repoRoot = resolve(import.meta.dirname, "../..");

async function fixture(): Promise<ProofArtifact> {
  return JSON.parse(
    await readFile(
      resolve(repoRoot, "worker/fixtures/historical-proof.json"),
      "utf8",
    ),
  ) as ProofArtifact;
}

describe("typed proof core", () => {
  it("encodes the committed fixture deterministically and round-trips the adapter tuple", async () => {
    const artifact = await fixture();
    const encodedA = encodeAttestcoinProof(proofFromArtifact(artifact));
    const encodedB = encodeAttestcoinProof(proofFromArtifact(artifact));
    expect(encodedA).toBe(encodedB);
    const decoded = decodeAttestcoinProof(encodedA);
    expect(decoded.chainKey).toBe(3n);
    expect(decoded.headerNumber).toBe(BigInt(artifact.proof.headerNumber));
    expect(decoded.txBytes).toBe(artifact.proof.txBytes);
    expect(decoded.merkleProof.siblings).toHaveLength(9);
    expect(decoded.continuityProof.roots).toHaveLength(6);
  });

  it("verifies the normalized artifact checksum and catches mutation", async () => {
    const artifact = await fixture();
    expect(verifyArtifactIntegrity(artifact).normalized).toBe(true);
    const mutated = structuredClone(artifact);
    mutated.proof.txIndex += 1;
    expect(() => verifyArtifactIntegrity(mutated)).toThrow(/checksum mismatch/);
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("rejects unpinned chain keys and malformed configuration", () => {
    expect(() =>
      encodeAttestcoinProof({
        chainKey: 4,
        headerNumber: 1,
        txBytes: "0x01",
        merkleProof: { root: `0x${"00".repeat(32)}`, siblings: [] },
        continuityProof: {
          lowerEndpointDigest: `0x${"00".repeat(32)}`,
          roots: [],
        },
      }),
    ).toThrow("unsupported Attestcoin chain key");

    expect(() => loadConfig({ CC3_RPC_URL: "not-a-url" })).toThrow(WorkerError);
  });

  it("validates the checked-in discovery lock boundary", async () => {
    const lock = JSON.parse(
      await readFile(resolve(repoRoot, "docs/discovery-lock.json"), "utf8"),
    );
    expect(validateDiscoveryLock(lock).networks.cc3.chainId).toBe(102031);
  });

  it("keeps raw sidecars distinct for every supported output name", () => {
    for (const name of [
      "proof",
      "proof.JSON",
      "proof.v1.json",
      "proof.raw.json",
    ]) {
      expect(resolve(rawArtifactPath(join("/tmp", name)))).not.toBe(
        resolve("/tmp", name),
      );
    }
  });

  it("requires and verifies the raw SDK sidecar checksum", async () => {
    const artifact = await fixture();
    const sourceDir = await mkdtemp(join("/tmp", "pegshield-artifact-"));
    const artifactPath = join(sourceDir, "proof.v1.JSON");
    const rawPath = rawArtifactPath(artifactPath);
    const fixtureRaw = await readFile(
      resolve(repoRoot, "worker/fixtures/historical-proof.raw.json"),
      "utf8",
    );
    await writeFile(artifactPath, `${JSON.stringify(artifact)}\n`, "utf8");
    await writeFile(rawPath, fixtureRaw, "utf8");
    await expect(readProofArtifact(artifactPath)).resolves.toEqual(artifact);

    const mutatedRaw = JSON.parse(fixtureRaw) as Record<string, unknown>;
    mutatedRaw.generatedAt = "2026-09-01T00:00:00.000Z";
    await writeFile(rawPath, `${JSON.stringify(mutatedRaw)}\n`, "utf8");
    await expect(readProofArtifact(artifactPath)).rejects.toThrow(
      /raw SDK artifact checksum mismatch/,
    );
    await expect(access(artifactPath)).resolves.toBeUndefined();
    await rm(sourceDir, { recursive: true, force: true });
  });

  it("rejects a receipt artifact with more than the exact three topics", async () => {
    const artifact = await fixture();
    const malformed = structuredClone(artifact);
    malformed.decodedExpected.topics.push(artifact.decodedExpected.topic0);
    expect(() => verifyArtifactIntegrity(malformed)).toThrow(
      /exactly three topics/,
    );
  });

  it("builds exact stage-specific CC3 claim calldata without trusting decoded facts", async () => {
    const artifact = await fixture();
    const breach = buildClaimCall("breach", parsePolicyId("7"), artifact);
    const confirmation = buildClaimCall(
      "confirmation",
      parsePolicyId("7"),
      artifact,
    );
    expect(breach.functionName).toBe("submitBreachProof");
    expect(confirmation.functionName).toBe("submitConfirmationProof");
    expect(breach.receiptLogPosition).toBe(2n);
    expect(breach.encodedProof.length).toBeGreaterThan(2);
    expect(claimArtifactDigest(breach)).not.toBe(
      claimArtifactDigest(confirmation),
    );
    expect(() => claimFunctionName("other")).toThrow(/breach or confirmation/);
  });
});
