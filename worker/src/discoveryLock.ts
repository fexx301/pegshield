import { readFile } from "node:fs/promises";
import { isAddress, isHex, type Address, type Hex } from "viem";
import { WorkerError } from "./errors.js";

export type DiscoveryLock = {
  networks: {
    cc3: {
      chainId: number;
      rpcUrl: string;
      blockProver: { address: Address; codeHash: Hex | null };
      chainInfo: { address: Address; codeHash: Hex | null };
      decoder: {
        required: true;
        address: Address;
        codeHash: Hex | null;
        fixtureTransactionType: number;
      };
    };
    ethereum: {
      chainId: number;
      attestcoinChainKey: number;
      underlyingAggregator: Address;
      answerUpdatedTopic0: Hex;
    };
  };
  fixture: {
    transactionHash: Hex;
    blockNumber: number;
    rpcBlockLogIndex: number;
    receiptLogPosition: number;
  };
};

function assertAddress(value: unknown, path: string): asserts value is Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new WorkerError("CONFIG_INVALID", `${path} must be an address`);
  }
}

function assertHash(value: unknown, path: string): asserts value is Hex {
  if (
    typeof value !== "string" ||
    !isHex(value, { strict: true }) ||
    value.length !== 66
  ) {
    throw new WorkerError(
      "CONFIG_INVALID",
      `${path} must be a 32-byte hex value`,
    );
  }
}

export function validateDiscoveryLock(lock: DiscoveryLock): DiscoveryLock {
  if (lock.networks.cc3.chainId !== 102031) {
    throw new WorkerError(
      "RPC_MISMATCH",
      "discovery lock is not pinned to CC3 chain 102031",
    );
  }
  if (
    lock.networks.ethereum.chainId !== 1 ||
    lock.networks.ethereum.attestcoinChainKey !== 3
  ) {
    throw new WorkerError(
      "RPC_MISMATCH",
      "discovery lock source chain values are not pinned",
    );
  }
  assertAddress(
    lock.networks.cc3.blockProver.address,
    "networks.cc3.blockProver.address",
  );
  assertAddress(
    lock.networks.cc3.chainInfo.address,
    "networks.cc3.chainInfo.address",
  );
  assertAddress(
    lock.networks.cc3.decoder.address,
    "networks.cc3.decoder.address",
  );
  assertAddress(
    lock.networks.ethereum.underlyingAggregator,
    "networks.ethereum.underlyingAggregator",
  );
  assertHash(
    lock.networks.ethereum.answerUpdatedTopic0,
    "networks.ethereum.answerUpdatedTopic0",
  );
  assertHash(lock.fixture.transactionHash, "fixture.transactionHash");
  if (
    lock.fixture.receiptLogPosition < 0 ||
    lock.fixture.rpcBlockLogIndex < 0
  ) {
    throw new WorkerError(
      "CONFIG_INVALID",
      "fixture log positions must be non-negative",
    );
  }
  return lock;
}

export async function readDiscoveryLock(path: string): Promise<DiscoveryLock> {
  const lock = JSON.parse(await readFile(path, "utf8")) as DiscoveryLock;
  return validateDiscoveryLock(lock);
}
