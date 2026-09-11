import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  isAddress,
  keccak256,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "./config.js";
import { WorkerError } from "./errors.js";
import { encodeAttestcoinProof } from "./proofEncoder.js";
import { proofFromArtifact, readProofArtifact } from "./proofArtifact.js";
import type { ProofArtifact } from "./types.js";

export const CC3_CHAIN: Chain = {
  id: 102031,
  name: "Creditcoin CC3 testnet",
  nativeCurrency: { name: "Creditcoin", symbol: "CTC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.cc3-testnet.creditcoin.network"] },
  },
  testnet: true,
};

// The public release is v3. Historical v1/v2 manifests stay in the repository
// as evidence, but must never be selected implicitly by claim tooling.
export const DEFAULT_DEPLOYMENT_MANIFEST = "deployments/cc3-testnet-v3.json";

export const CLAIM_ABI = [
  {
    type: "function",
    name: "submitClaim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "policyId", type: "uint256" },
      { name: "firstEncodedProof", type: "bytes" },
      { name: "firstReceiptLogPosition", type: "uint256" },
      { name: "confirmationEncodedProof", type: "bytes" },
      { name: "confirmationReceiptLogPosition", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

type DeploymentManifest = {
  network?: { chainId?: number };
  contracts?: {
    pool?: { address?: string; codeHash?: string };
  };
};

type ClaimCall = {
  functionName: "submitClaim";
  policyId: bigint;
  firstEncodedProof: Hex;
  firstReceiptLogPosition: bigint;
  confirmationEncodedProof: Hex;
  confirmationReceiptLogPosition: bigint;
  data: Hex;
};

export function resolveDeploymentManifestPath(repoRoot: string): string {
  return resolve(
    repoRoot,
    process.env.DEPLOYMENT_MANIFEST ?? DEFAULT_DEPLOYMENT_MANIFEST,
  );
}

export function parsePolicyId(value: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new WorkerError(
      "CONFIG_INVALID",
      "policy must be a positive decimal integer",
    );
  }
  return BigInt(value);
}

export function buildClaimCall(
  policyId: bigint,
  firstArtifact: ProofArtifact,
  confirmationArtifact: ProofArtifact,
): ClaimCall {
  const functionName = "submitClaim";
  const firstEncodedProof = encodeAttestcoinProof(
    proofFromArtifact(firstArtifact),
  );
  const firstReceiptLogPosition = BigInt(
    firstArtifact.source.receiptLogPosition,
  );
  const confirmationEncodedProof = encodeAttestcoinProof(
    proofFromArtifact(confirmationArtifact),
  );
  const confirmationReceiptLogPosition = BigInt(
    confirmationArtifact.source.receiptLogPosition,
  );
  const data = encodeFunctionData({
    abi: CLAIM_ABI,
    functionName,
    args: [
      policyId,
      firstEncodedProof,
      firstReceiptLogPosition,
      confirmationEncodedProof,
      confirmationReceiptLogPosition,
    ],
  });
  return {
    functionName,
    policyId,
    firstEncodedProof,
    firstReceiptLogPosition,
    confirmationEncodedProof,
    confirmationReceiptLogPosition,
    data,
  };
}

export async function readClaimArtifact(path: string): Promise<ProofArtifact> {
  return readProofArtifact(resolve(process.cwd(), path));
}

export function claimArtifactDigest(call: ClaimCall): Hex {
  return keccak256(call.data);
}

function gasLimitWithHeadroom(
  estimate: bigint | undefined,
  headroomBps: number,
): bigint {
  if (estimate === undefined || estimate <= 0n) {
    throw new WorkerError(
      "PROOF_SIMULATION_FAILED",
      "CC3 simulation did not return a usable gas estimate",
      { retryable: true },
    );
  }
  const bps = BigInt(headroomBps);
  return (estimate * bps + 9_999n) / 10_000n;
}

async function estimateClaimGas(options: {
  client: PublicClient;
  poolAddress: Address;
  call: ClaimCall;
  account?: Address | Account;
}): Promise<bigint> {
  return options.client.estimateContractGas({
    address: options.poolAddress,
    abi: CLAIM_ABI,
    functionName: options.call.functionName,
    args: [
      options.call.policyId,
      options.call.firstEncodedProof,
      options.call.firstReceiptLogPosition,
      options.call.confirmationEncodedProof,
      options.call.confirmationReceiptLogPosition,
    ],
    account: options.account,
  });
}

export function resolvePoolAddress(repoRoot: string): Address {
  const manifestPath = resolveDeploymentManifestPath(repoRoot);
  let manifest: DeploymentManifest | undefined;
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(
        readFileSync(manifestPath, "utf8"),
      ) as DeploymentManifest;
    } catch {
      throw new WorkerError(
        "CONFIG_INVALID",
        "deployment manifest is not valid JSON",
      );
    }
    if (manifest.network?.chainId !== 102031) {
      throw new WorkerError(
        "RPC_MISMATCH",
        "deployment manifest is not pinned to CC3 chain 102031",
      );
    }
  }
  const configured = process.env.PEGSHIELD_POOL_ADDRESS;
  const candidate = configured ?? manifest?.contracts?.pool?.address;
  if (!candidate || !isAddress(candidate)) {
    throw new WorkerError(
      "CONFIG_INVALID",
      "PEGSHIELD_POOL_ADDRESS or a validated deployment manifest is required",
    );
  }
  if (
    configured &&
    manifest?.contracts?.pool?.address &&
    configured.toLowerCase() !== manifest.contracts.pool.address.toLowerCase()
  ) {
    throw new WorkerError(
      "CONFIG_INVALID",
      "PEGSHIELD_POOL_ADDRESS differs from the deployment manifest",
    );
  }
  return candidate as Address;
}

export function createCc3PublicClient(): PublicClient {
  const config = loadConfig();
  const chain = {
    ...CC3_CHAIN,
    rpcUrls: { default: { http: [config.cc3RpcUrl] } },
  } satisfies Chain;
  return createPublicClient({ chain, transport: http(config.cc3RpcUrl) });
}

export async function assertPoolRuntime(
  client: PublicClient,
  repoRoot: string,
  poolAddress: Address,
): Promise<void> {
  const manifestPath = resolveDeploymentManifestPath(repoRoot);
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as DeploymentManifest;
  const expected = manifest.contracts?.pool?.codeHash;
  if (!expected) {
    throw new WorkerError(
      "CONFIG_INVALID",
      "deployment manifest is missing the pool runtime code hash",
    );
  }
  const bytecode = await client.getBytecode({ address: poolAddress });
  if (!bytecode || bytecode === "0x") {
    throw new WorkerError(
      "RPC_MISMATCH",
      "no pool runtime code exists at the configured address",
    );
  }
  const actual = keccak256(bytecode);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new WorkerError(
      "RPC_MISMATCH",
      "pool runtime code hash differs from the deployment manifest",
    );
  }
}

export async function simulateClaim(options: {
  repoRoot: string;
  policyId: bigint;
  firstArtifact: ProofArtifact;
  confirmationArtifact: ProofArtifact;
  from?: Address;
}) {
  const poolAddress = resolvePoolAddress(options.repoRoot);
  const client = createCc3PublicClient();
  if ((await client.getChainId()) !== 102031) {
    throw new WorkerError(
      "RPC_MISMATCH",
      "CC3 RPC returned the wrong chain ID",
    );
  }
  await assertPoolRuntime(client, options.repoRoot, poolAddress);
  const call = buildClaimCall(
    options.policyId,
    options.firstArtifact,
    options.confirmationArtifact,
  );
  const result = await client.simulateContract({
    address: poolAddress,
    abi: CLAIM_ABI,
    functionName: call.functionName,
    args: [
      call.policyId,
      call.firstEncodedProof,
      call.firstReceiptLogPosition,
      call.confirmationEncodedProof,
      call.confirmationReceiptLogPosition,
    ],
    account: options.from,
  });
  const config = loadConfig();
  // CC3's eth_call simulation returns the successful result but omits the
  // optional gas field. Fall back to the dedicated estimator rather than
  // treating an absent field as a safe estimate.
  const gasEstimate =
    result.request.gas ??
    (await estimateClaimGas({
      client,
      poolAddress,
      call,
      account: options.from,
    }));
  const gasLimit = gasLimitWithHeadroom(
    gasEstimate,
    config.claimGasHeadroomBps,
  );
  return {
    poolAddress,
    call,
    gasEstimate,
    gasLimit,
    gasHeadroomBps: config.claimGasHeadroomBps,
    result: result.result,
  };
}

function configuredAccount(): Account {
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!key) {
    throw new WorkerError(
      "CONFIG_INVALID",
      "RELAYER_PRIVATE_KEY is required for proof submit",
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new WorkerError(
      "CONFIG_INVALID",
      "RELAYER_PRIVATE_KEY must be a 32-byte hex key",
    );
  }
  const account = privateKeyToAccount(key as Hex);
  const configuredAddress = process.env.RELAYER_ADDRESS;
  if (
    configuredAddress &&
    (!isAddress(configuredAddress) ||
      configuredAddress.toLowerCase() !== account.address.toLowerCase())
  ) {
    throw new WorkerError(
      "CONFIG_INVALID",
      "RELAYER_ADDRESS does not match RELAYER_PRIVATE_KEY",
    );
  }
  return account;
}

export async function submitClaim(options: {
  repoRoot: string;
  policyId: bigint;
  firstArtifact: ProofArtifact;
  confirmationArtifact: ProofArtifact;
}) {
  const account = configuredAccount();
  const poolAddress = resolvePoolAddress(options.repoRoot);
  const config = loadConfig();
  const chain = {
    ...CC3_CHAIN,
    rpcUrls: { default: { http: [config.cc3RpcUrl] } },
  } satisfies Chain;
  const publicClient = createPublicClient({
    chain,
    transport: http(config.cc3RpcUrl),
  });
  if ((await publicClient.getChainId()) !== 102031) {
    throw new WorkerError(
      "RPC_MISMATCH",
      "CC3 RPC returned the wrong chain ID",
    );
  }
  await assertPoolRuntime(publicClient, options.repoRoot, poolAddress);
  const call = buildClaimCall(
    options.policyId,
    options.firstArtifact,
    options.confirmationArtifact,
  );
  const simulation = await publicClient.simulateContract({
    address: poolAddress,
    abi: CLAIM_ABI,
    functionName: call.functionName,
    args: [
      call.policyId,
      call.firstEncodedProof,
      call.firstReceiptLogPosition,
      call.confirmationEncodedProof,
      call.confirmationReceiptLogPosition,
    ],
    account,
  });
  const gasEstimate =
    simulation.request.gas ??
    (await estimateClaimGas({
      client: publicClient,
      poolAddress,
      call,
      account,
    }));
  const gasLimit = gasLimitWithHeadroom(
    gasEstimate,
    config.claimGasHeadroomBps,
  );
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.cc3RpcUrl),
  });
  const hash = await walletClient.writeContract({
    ...simulation.request,
    gas: gasLimit,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new WorkerError(
      "PROOF_SUBMISSION_FAILED",
      "proof transaction was mined unsuccessfully",
      { details: { transactionHash: hash } },
    );
  }
  return {
    poolAddress,
    call,
    hash,
    receipt,
    relayer: account.address,
    gasEstimate,
    gasLimit,
    gasHeadroomBps: config.claimGasHeadroomBps,
  };
}

export type { ClaimCall };
