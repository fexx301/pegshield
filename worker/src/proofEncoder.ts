import { decodeAbiParameters, encodeAbiParameters, type Hex } from "viem";
import type { EncodableProof } from "./types.js";

/**
 * The one canonical proof ABI accepted by AttestcoinVerifierAdapter. Keep
 * this definition local to the worker and adapter; the business pool never
 * sees these proof structs.
 */
export const ATTESTCOIN_PROOF_PARAMETERS = [
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

export function encodeAttestcoinProof(proof: EncodableProof): Hex {
  if (proof.chainKey !== 3 && proof.chainKey !== 3n) {
    throw new Error(
      `unsupported Attestcoin chain key: ${String(proof.chainKey)}`,
    );
  }
  if (!proof.txBytes.startsWith("0x") || proof.txBytes.length < 4) {
    throw new Error("encoded transaction must be non-empty hex");
  }
  return encodeAbiParameters(ATTESTCOIN_PROOF_PARAMETERS, [
    BigInt(proof.chainKey),
    BigInt(proof.headerNumber),
    proof.txBytes,
    {
      root: proof.merkleProof.root,
      siblings: proof.merkleProof.siblings.map(({ hash, isLeft }) => ({
        hash,
        isLeft,
      })),
    },
    {
      lowerEndpointDigest: proof.continuityProof.lowerEndpointDigest,
      roots: proof.continuityProof.roots,
    },
  ]);
}

export function decodeAttestcoinProof(encoded: Hex): EncodableProof {
  const [chainKey, height, encodedTransaction, merkleProof, continuityProof] =
    decodeAbiParameters(ATTESTCOIN_PROOF_PARAMETERS, encoded);
  return {
    chainKey,
    headerNumber: height,
    txBytes: encodedTransaction,
    merkleProof,
    continuityProof,
  };
}
