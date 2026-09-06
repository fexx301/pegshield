import { describe, expect, it } from "vitest";
import { selectPair, type Observation } from "../lib/eligibility";

const terms = {
  startsAt: 1000n,
  endsAt: 2000n,
  triggerBelow: 100n,
  minBreachDuration: 300n,
};
const event = (round: number, time: number, answer = "99"): Observation => ({
  transactionHash: `0x${round.toString(16).padStart(64, "0")}`,
  blockNumber: round,
  roundId: String(round),
  answer,
  updatedAt: time,
});
describe("automatic observation selection", () => {
  it("rejects pre-activation, post-coverage, zero, and at-threshold observations", () => {
    expect(
      selectPair(
        [
          event(1, 999),
          event(2, 2001),
          event(3, 1100, "0"),
          event(4, 1500, "100"),
        ],
        terms,
      ),
    ).toEqual([]);
  });
  it("accepts inclusive coverage boundaries and exact minimum spacing", () => {
    expect(
      selectPair([event(2, 1300), event(1, 1000)], terms).map((e) => e.roundId),
    ).toEqual(["1", "2"]);
    expect(selectPair([event(1, 1700), event(2, 2000)], terms)).toHaveLength(2);
  });
  it("requires a distinct, later round and timestamp", () => {
    expect(
      selectPair([event(1, 1000), event(1, 1400), event(0, 1500)], terms),
    ).toHaveLength(1);
    expect(selectPair([event(1, 1000), event(2, 1299)], terms)).toHaveLength(1);
  });
  it("finds a later valid pair without pinning an unusable first event", () => {
    expect(
      selectPair([event(5, 1000), event(1, 1100), event(2, 1500)], terms).map(
        (e) => e.roundId,
      ),
    ).toEqual(["1", "2"]);
  });
});
