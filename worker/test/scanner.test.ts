import { describe, expect, it } from "vitest";
import { decodeAnswerUpdatedLog } from "../src/eventScanner.js";

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
