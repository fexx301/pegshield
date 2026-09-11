import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { keccak256, type PublicClient } from "viem";
import {
  assertPoolRuntime,
  DEFAULT_DEPLOYMENT_MANIFEST,
  resolveDeploymentManifestPath,
  resolvePoolAddress,
} from "../src/cc3Client.js";

const originalManifest = process.env.DEPLOYMENT_MANIFEST;

afterEach(() => {
  if (originalManifest === undefined) delete process.env.DEPLOYMENT_MANIFEST;
  else process.env.DEPLOYMENT_MANIFEST = originalManifest;
});

describe("deployment manifest selection", () => {
  it("defaults both address and runtime checks to the v3 manifest", async () => {
    delete process.env.DEPLOYMENT_MANIFEST;
    expect(DEFAULT_DEPLOYMENT_MANIFEST).toBe("deployments/cc3-testnet-v3.json");
    const tempRoot = await mkdtemp(join("/tmp", "pegshield-default-manifest-"));
    try {
      const manifestDir = join(tempRoot, "deployments");
      await mkdir(manifestDir, { recursive: true });
      const poolAddress = "0x1111111111111111111111111111111111111111";
      const bytecode = "0x1234" as const;
      await writeFile(
        join(tempRoot, DEFAULT_DEPLOYMENT_MANIFEST),
        JSON.stringify({
          network: { chainId: 102031 },
          contracts: {
            pool: { address: poolAddress, codeHash: keccak256(bytecode) },
          },
        }),
      );

      expect(resolveDeploymentManifestPath(tempRoot)).toBe(
        resolve(tempRoot, DEFAULT_DEPLOYMENT_MANIFEST),
      );
      expect(resolvePoolAddress(tempRoot)).toBe(poolAddress);
      const client = {
        getBytecode: async () => bytecode,
      } as unknown as PublicClient;
      await expect(
        assertPoolRuntime(client, tempRoot, poolAddress),
      ).resolves.toBeUndefined();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses an explicit manifest override for both call sites", async () => {
    const tempRoot = await mkdtemp(join("/tmp", "pegshield-manifest-"));
    try {
      const manifestDir = join(tempRoot, "deployments");
      await mkdir(manifestDir, { recursive: true });
      const poolAddress = "0x1111111111111111111111111111111111111111";
      const bytecode = "0x1234" as const;
      const override = join("deployments", "override.json");
      await writeFile(
        join(tempRoot, override),
        JSON.stringify({
          network: { chainId: 102031 },
          contracts: {
            pool: { address: poolAddress, codeHash: keccak256(bytecode) },
          },
        }),
      );
      process.env.DEPLOYMENT_MANIFEST = override;

      expect(resolveDeploymentManifestPath(tempRoot)).toBe(
        resolve(tempRoot, override),
      );
      expect(resolvePoolAddress(tempRoot)).toBe(poolAddress);
      const client = {
        getBytecode: async () => bytecode,
      } as unknown as PublicClient;
      await expect(
        assertPoolRuntime(client, tempRoot, poolAddress),
      ).resolves.toBeUndefined();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
