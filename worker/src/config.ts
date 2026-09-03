import { WorkerError } from "./errors.js";

export const CC3_CHAIN_ID = 102031;
export const ATTESTCOIN_CHAIN_KEY = 3;
export const DEFAULT_CC3_RPC_URL = "https://rpc.cc3-testnet.creditcoin.network";
export const DEFAULT_PROOF_SERVICE_URL =
  "https://prover.cc3-testnet.creditcoin.network";

export type WorkerConfig = {
  cc3RpcUrl: string;
  proofServiceUrl: string;
  ethereumRpcUrl?: string;
  requestTimeoutMs: number;
  maxRetries: number;
  claimGasHeadroomBps: number;
};

function requiredUrl(name: string, value: string | undefined): string {
  if (!value) throw new WorkerError("CONFIG_INVALID", `${name} is required`);
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      throw new Error();
  } catch {
    throw new WorkerError("CONFIG_INVALID", `${name} must be an http(s) URL`);
  }
  return value.replace(/\/$/, "");
}

function positiveInt(
  name: string,
  value: string | undefined,
  fallback: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new WorkerError(
      "CONFIG_INVALID",
      `${name} must be a positive integer`,
    );
  }
  return parsed;
}

function gasHeadroomBps(value: string | undefined): number {
  const parsed = value === undefined ? 12_000 : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 10_000 || parsed > 50_000) {
    throw new WorkerError(
      "CONFIG_INVALID",
      "CLAIM_GAS_HEADROOM_BPS must be an integer from 10000 to 50000",
    );
  }
  return parsed;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  return {
    cc3RpcUrl: requiredUrl(
      "CC3_RPC_URL",
      environment.CC3_RPC_URL ?? DEFAULT_CC3_RPC_URL,
    ),
    proofServiceUrl: requiredUrl(
      "ATTESTCOIN_PROVER_URL",
      environment.ATTESTCOIN_PROVER_URL ?? DEFAULT_PROOF_SERVICE_URL,
    ),
    ethereumRpcUrl: environment.ETHEREUM_RPC_URL
      ? requiredUrl("ETHEREUM_RPC_URL", environment.ETHEREUM_RPC_URL)
      : undefined,
    requestTimeoutMs: positiveInt(
      "REQUEST_TIMEOUT_MS",
      environment.REQUEST_TIMEOUT_MS,
      30_000,
    ),
    maxRetries: positiveInt("MAX_RETRIES", environment.MAX_RETRIES, 2),
    claimGasHeadroomBps: gasHeadroomBps(environment.CLAIM_GAS_HEADROOM_BPS),
  };
}
