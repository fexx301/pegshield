import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  block: vi.fn(),
  logs: vi.fn(),
  receipt: vi.fn(),
  ethBlock: vi.fn(),
}));
vi.mock("../lib/chain", () => ({
  CC3_TESTNET: { id: 102031 },
  PEGSHIELD_POOL_ADDRESS: "0x1111111111111111111111111111111111111111",
  POOL_READ_ABI: [],
}));
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: (options: { chain?: unknown }) =>
    options.chain
      ? { readContract: mocks.read, getBlock: mocks.block }
      : {
          getBlock: mocks.ethBlock,
          getLogs: mocks.logs,
          getTransactionReceipt: mocks.receipt,
        },
}));
import { discoverClaim, prepareClaim } from "../lib/claim-service";
import {
  ANSWER_UPDATED_TOPIC,
  LOCKED_AGGREGATOR,
  validateProofArtifact,
} from "../lib/proof";
let state = 0;
let now = 1600n;
const policy = { productId: 1n, startsAt: 1000n, endsAt: 2000n };
const signal = () => AbortSignal.timeout(3000);
beforeEach(() => {
  vi.clearAllMocks();
  state = 0;
  now = 1600n;
  mocks.read.mockImplementation(({ functionName }) =>
    functionName === "getPolicy"
      ? { ...policy, state }
      : {
          chainKey: 3n,
          aggregator: LOCKED_AGGREGATOR,
          triggerBelow: 100n,
          minBreachDuration: 300n,
          claimGracePeriod: 500n,
        },
  );
  mocks.block.mockImplementation(async () => ({ timestamp: now }));
  mocks.ethBlock.mockImplementation(async ({ blockNumber }) => ({
    number: blockNumber ?? 160n,
    timestamp: (blockNumber ?? 160n) * 10n,
  }));
  mocks.logs.mockResolvedValue([]);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ attestedHeight: 160 })),
  );
});

describe("automatic proof preparation", () => {
  const hash = (n: number) => `0x${String(n).repeat(64)}`;
  const word = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
  function evidence() {
    const blocks = [100, 140];
    mocks.logs.mockResolvedValue(
      blocks.map((block, index) => ({
        transactionHash: hash(index + 1),
        blockNumber: BigInt(block),
        args: {
          current: 99n,
          roundId: BigInt(index + 1),
          updatedAt: BigInt(block * 10),
        },
      })),
    );
    mocks.receipt.mockImplementation(async ({ hash: tx }) => {
      const index = tx === hash(1) ? 0 : 1;
      const block = blocks[index]!;
      return {
        status: "success",
        transactionHash: tx,
        blockNumber: BigInt(block),
        transactionIndex: 0,
        logs: [
          {
            address: LOCKED_AGGREGATOR,
            topics: [ANSWER_UPDATED_TOPIC, word(99), word(index + 1)],
            data: word(block * 10),
            logIndex: 7,
          },
        ],
      };
    });
    const batch = {
      chainKey: 3,
      cached: false,
      generatedAt: new Date().toISOString(),
      continuityProof: { lowerEndpointDigest: hash(3), roots: [hash(4)] },
      merkleProofs: Object.fromEntries(
        blocks.map((block, index) => [
          block,
          {
            0: {
              txHash: hash(index + 1),
              txBytes: "0x1234",
              merkleProof: { root: hash(5), siblings: [] },
            },
          },
        ]),
      ),
    };
    vi.mocked(fetch).mockImplementation(async (url) =>
      Response.json(
        String(url).includes("attested-height")
          ? { attestedHeight: 160 }
          : batch,
      ),
    );
    return batch;
  }
  it("normalizes a shared fresh batch into browser-valid artifacts", async () => {
    evidence();
    const result = await prepareClaim(1n, signal());
    expect(result.artifacts).toHaveLength(2);
    for (const artifact of result.artifacts!)
      await validateProofArtifact(artifact);
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining("proof-batch-by-tx/3"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify([hash(1), hash(2)]),
      }),
    );
  });
  it("rejects proof transactions that do not match discovery", async () => {
    const batch = evidence();
    batch.merkleProofs[100]![0].txHash = hash(9);
    await expect(prepareClaim(1n, signal())).rejects.toThrow(
      "proof identity mismatch",
    );
  });
  it("rejects reverted source transactions", async () => {
    evidence();
    mocks.receipt.mockResolvedValue({ status: "reverted" });
    await expect(prepareClaim(1n, signal())).rejects.toThrow("source reverted");
  });
  it("rejects receipts for a different source block", async () => {
    evidence();
    mocks.receipt.mockResolvedValue({
      status: "success",
      transactionHash: hash(1),
      blockNumber: 101n,
    });
    await expect(prepareClaim(1n, signal())).rejects.toThrow(
      "receipt identity mismatch",
    );
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("policy discovery service", () => {
  it("short circuits settled and activation states without scanning", async () => {
    state = 2;
    expect((await discoverClaim(1n, signal())).eligibility.status).toBe(
      "claimed",
    );
    state = 0;
    now = 900n;
    expect((await discoverClaim(1n, signal())).eligibility.status).toBe(
      "activation",
    );
    expect(mocks.logs).not.toHaveBeenCalled();
  });
  it("checks the grace deadline before preparing evidence", async () => {
    now = 2501n;
    expect((await prepareClaim(1n, signal())).eligibility.status).toBe(
      "expired",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("locates the start by block timestamps", async () => {
    expect((await discoverClaim(1n, signal())).eligibility.status).toBe(
      "first",
    );
    expect(mocks.logs).toHaveBeenCalledWith(
      expect.objectContaining({
        fromBlock: 100n,
        toBlock: 160n,
        address: LOCKED_AGGREGATOR,
      }),
    );
  });
  it("does not close coverage while finalized source blocks lag", async () => {
    now = 2100n;
    expect((await discoverClaim(1n, signal())).eligibility.status).toBe(
      "first",
    );
  });
  it("waits for Attestcoin before preparing proofs", async () => {
    mocks.logs.mockResolvedValue(
      [100, 140].map((block, index) => ({
        transactionHash: `0x${String(index + 1).repeat(64)}`,
        blockNumber: BigInt(block),
        args: {
          current: 99n,
          roundId: BigInt(index + 1),
          updatedAt: BigInt(block * 10),
        },
      })),
    );
    vi.mocked(fetch).mockResolvedValue(Response.json({ attestedHeight: 130 }));
    const result = await prepareClaim(1n, signal());
    expect(result.eligibility.status).toBe("attestation");
    expect(result).not.toHaveProperty("artifacts");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
