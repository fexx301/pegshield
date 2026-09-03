import type { Address, Hash, Hex } from "viem";

export type ProofSibling = { hash: Hex; isLeft: boolean };
export type MerkleProof = { root: Hex; siblings: readonly ProofSibling[] };
export type ContinuityProof = {
  lowerEndpointDigest: Hex;
  roots: readonly Hex[];
};

export type EncodableProof = {
  chainKey: number | bigint;
  headerNumber: number | bigint;
  txBytes: Hex;
  merkleProof: MerkleProof;
  continuityProof: ContinuityProof;
};

export type ProofArtifact = {
  $schema: "../../docs/schemas/proof-artifact.schema.json";
  version: 1;
  source: {
    chainId: 1;
    chainKey: 3;
    transactionHash: Hash;
    blockNumber: number;
    transactionIndex: number;
    rpcBlockLogIndex: number;
    receiptLogPosition: number;
    emitter: Address;
  };
  decodedExpected: {
    topic0: Hex;
    topics: Hex[];
    data: Hex;
    roundId: string;
    answer: string;
    updatedAt: number;
    receiptStatus: "success";
  };
  proof: {
    sdkVersion: "0.18.0";
    chainKey: 3;
    headerNumber: number;
    txIndex: number;
    txHash: Hash;
    txBytes: Hex;
    merkleProof: MerkleProof;
    continuityProof: ContinuityProof;
    cached: boolean;
    generatedAt: string;
  };
  integrity: {
    canonicalJsonSha256: `sha256:${string}`;
    rawSdkJsonSha256: `sha256:${string}`;
  };
};
