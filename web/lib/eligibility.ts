export type Observation = {
  transactionHash: `0x${string}`;
  blockNumber: number;
  roundId: string;
  answer: string;
  updatedAt: number;
};

export type Eligibility = {
  status:
    | "activation"
    | "first"
    | "confirmation"
    | "attestation"
    | "eligible"
    | "claimed"
    | "expired"
    | "closed";
  observations: Observation[];
  checkedAt: string;
};

export function selectPair(
  events: Observation[],
  terms: {
    startsAt: bigint;
    endsAt: bigint;
    triggerBelow: bigint;
    minBreachDuration: bigint;
  },
): Observation[] {
  const eligible = events
    .filter(
      (e) =>
        BigInt(e.answer) > 0n &&
        BigInt(e.answer) < terms.triggerBelow &&
        BigInt(e.updatedAt) >= terms.startsAt &&
        BigInt(e.updatedAt) <= terms.endsAt,
    )
    .sort((a, b) => a.updatedAt - b.updatedAt || a.blockNumber - b.blockNumber);
  for (const first of eligible) {
    const second = eligible.find(
      (e) =>
        e.transactionHash !== first.transactionHash &&
        BigInt(e.roundId) > BigInt(first.roundId) &&
        e.updatedAt > first.updatedAt &&
        BigInt(e.updatedAt - first.updatedAt) >= terms.minBreachDuration,
    );
    if (second) return [first, second];
  }
  return eligible.slice(0, 1);
}

export const eligibilityCopy: Record<Eligibility["status"], [string, string]> =
  {
    activation: [
      "Coverage starts soon",
      "Observations before activation cannot qualify. We’ll check again automatically.",
    ],
    first: [
      "Waiting for the first observation",
      "Your policy is active. The next qualifying oracle update time is not guaranteed.",
    ],
    confirmation: [
      "Waiting for confirmation",
      "One qualifying observation was found. A later observation must also meet your policy’s price and timing conditions.",
    ],
    attestation: [
      "Waiting for network verification",
      "Both observations were found. Attestcoin needs to make their blocks available before evidence can be prepared.",
    ],
    eligible: [
      "Two observations found",
      "Prepare your claim to fetch current evidence. Creditcoin will check the payout conditions before you sign.",
    ],
    claimed: [
      "Payout completed",
      "This policy has already paid its beneficiary. It cannot pay twice.",
    ],
    expired: [
      "Claim period ended",
      "The deadline for submitting this policy’s claim has passed.",
    ],
    closed: [
      "Coverage window ended",
      "No qualifying pair was found within coverage. New observations cannot qualify for this policy.",
    ],
  };
