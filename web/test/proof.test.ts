import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANSWER_UPDATED_TOPIC,
  LOCKED_AGGREGATOR,
  encodeProof,
  proofDigest,
  validateProofArtifact,
} from "../lib/proof";

function fixture(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "../worker/fixtures/historical-proof.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

describe("browser proof boundary", () => {
  it("accepts the normalized worker fixture and produces the claim encoding", async () => {
    const result = await validateProofArtifact(fixture());

    expect(result.checksum).toBe(
      "sha256:88d6ab63667502fa154f3e5d7ff5ea1ae5e0a87fef73563c1d45dfa38dec6764",
    );
    expect(result.artifact.source.emitter).toBe(LOCKED_AGGREGATOR);
    expect(result.artifact.decodedExpected.topic0).toBe(ANSWER_UPDATED_TOPIC);
    expect(encodeProof(result.artifact)).toMatch(/^0x[0-9a-f]+$/);
    expect(proofDigest(result.artifact)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("rejects a source mutation before it can reach CC3", async () => {
    const artifact = fixture();
    const source = artifact.source as Record<string, unknown>;
    source.emitter = "0x0000000000000000000000000000000000000001";

    await expect(validateProofArtifact(artifact)).rejects.toThrow(
      "locked aggregator",
    );
  });

  it("rejects a checksum mutation even when the shape remains valid", async () => {
    const artifact = fixture();
    const decoded = artifact.decodedExpected as Record<string, unknown>;
    decoded.answer = "99989776";

    await expect(validateProofArtifact(artifact)).rejects.toThrow(
      "checksum mismatch",
    );
  });
});
