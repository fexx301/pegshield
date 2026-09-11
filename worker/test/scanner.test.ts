import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeAnswerUpdatedLog,
  scanAnswerUpdatedEvents,
} from "../src/eventScanner.js";

const { getLogs, getTransactionReceipt } = vi.hoisted(() => ({
  getLogs: vi.fn(),
  getTransactionReceipt: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createPublicClient: () => ({ getLogs, getTransactionReceipt }),
  };
});

const EMITTER = "0xc9e1a09622afdb659913fefe800feae5dbbfe9d7" as `0x${string}`;
const TOPIC0 =
  "0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f" as `0x${string}`;
const TX = `0x${"11".repeat(32)}` as `0x${string}`;

function log(overrides: Record<string, unknown> = {}) {
  return {
    address: EMITTER,
    topics: [
      TOPIC0,
      `0x${99_989_777n.toString(16).padStart(64, "0")}`,
      `0x${1166n.toString(16).padStart(64, "0")}`,
    ],
    data: `0x${1_788_249_611n.toString(16).padStart(64, "0")}`,
    transactionHash: TX,
    blockNumber: 25_881_095n,
    logIndex: 516n,
    ...overrides,
  } as never;
}

function topicsFor(answer: bigint): `0x${string}`[] {
  const encoded = answer < 0n ? (1n << 256n) + answer : answer;
  return [
    TOPIC0,
    `0x${encoded.toString(16).padStart(64, "0")}`,
    `0x${1166n.toString(16).padStart(64, "0")}`,
  ];
}

describe("AnswerUpdated scanner boundary", () => {
  it("decodes only the locked exact event shape", () => {
    expect(decodeAnswerUpdatedLog(log(), EMITTER, TOPIC0)).toMatchObject({
      transactionHash: TX,
      blockNumber: 25_881_095,
      rpcBlockLogIndex: 516,
      answer: "99989777",
      roundId: "1166",
      updatedAt: 1_788_249_611,
    });
  });

  it("rejects a wrong emitter, topic, or topic count", () => {
    expect(() =>
      decodeAnswerUpdatedLog(
        log({ address: "0x0000000000000000000000000000000000000001" }),
        EMITTER,
        TOPIC0,
      ),
    ).toThrow(/emitter/);
    expect(() =>
      decodeAnswerUpdatedLog(
        log({
          topics: [TOPIC0, `0x${"00".repeat(32)}`, `0x${"00".repeat(32)}`],
        }),
        EMITTER,
        `0x${"aa".repeat(32)}`,
      ),
    ).toThrow(/AnswerUpdated shape/);
    expect(() =>
      decodeAnswerUpdatedLog(
        log({ topics: [...log().topics, TOPIC0] }),
        EMITTER,
        TOPIC0,
      ),
    ).toThrow(/AnswerUpdated shape/);
  });

  it("preserves signed answers at the event boundary", () => {
    const negative = `0x${((1n << 256n) - 1n).toString(16)}` as `0x${string}`;
    expect(
      decodeAnswerUpdatedLog(
        log({ topics: [TOPIC0, negative, `0x${"01".padStart(64, "0")}`] }),
        EMITTER,
        TOPIC0,
      ).answer,
    ).toBe("-1");
  });
});

describe("scanAnswerUpdatedEvents", () => {
  beforeEach(() => {
    getLogs.mockReset();
    getTransactionReceipt.mockReset();
  });

  it("rejects ranges wider than 10000 blocks before fetching logs", async () => {
    await expect(
      scanAnswerUpdatedEvents({ fromBlock: 0, toBlock: 10_001 }),
    ).rejects.toThrow(/no larger than 10000 blocks/);
    expect(getLogs).not.toHaveBeenCalled();
  });

  it("keeps answers strictly below the trigger and nothing equal to it", async () => {
    const atTrigger = `0x${"33".repeat(32)}` as `0x${string}`;
    const belowTrigger = `0x${"44".repeat(32)}` as `0x${string}`;
    getLogs.mockResolvedValueOnce([
      log({ topics: topicsFor(100n), transactionHash: atTrigger }),
      log({ topics: topicsFor(99n), transactionHash: belowTrigger }),
    ]);
    getTransactionReceipt.mockResolvedValue({
      status: "success",
      logs: [{ logIndex: 516n, address: EMITTER }],
    });

    const events = await scanAnswerUpdatedEvents({
      fromBlock: 25_881_094,
      toBlock: 25_881_095,
      triggerBelow: 100n,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      transactionHash: belowTrigger,
      answer: "99",
      receiptLogPosition: 0,
      receiptStatus: "success",
    });
    expect(getTransactionReceipt).toHaveBeenCalledTimes(1);
  });

  it("excludes zero and negative answers outright", async () => {
    getLogs.mockResolvedValueOnce([
      log({ topics: topicsFor(0n), transactionHash: `0x${"55".repeat(32)}` }),
      log({ topics: topicsFor(-1n), transactionHash: `0x${"66".repeat(32)}` }),
    ]);

    const events = await scanAnswerUpdatedEvents({
      fromBlock: 25_881_094,
      toBlock: 25_881_095,
      triggerBelow: 1_000n,
    });

    expect(events).toEqual([]);
    expect(getTransactionReceipt).not.toHaveBeenCalled();
  });
});
