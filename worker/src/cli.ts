import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { readDiscoveryLock } from "./discoveryLock.js";
import { WorkerError, stableError } from "./errors.js";
import {
  encodedProofDigest,
  proofFromArtifact,
  readProofArtifact,
  verifyArtifactIntegrity,
} from "./proofArtifact.js";
import { encodeAttestcoinProof } from "./proofEncoder.js";
import { buildProofArtifact } from "./proofBuilder.js";
import { scanAnswerUpdatedEvents } from "./eventScanner.js";
import {
  claimArtifactDigest,
  parsePolicyId,
  readClaimArtifact,
  simulateClaim,
  submitClaim,
} from "./cc3Client.js";

type JsonResult = Record<string, unknown>;

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  const value = index < 0 ? undefined : argv[index + 1];
  // Never consume a following flag as this flag's value; requiredFlag then
  // names the flag that is missing one.
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

function requiredFlag(argv: string[], name: string): string {
  const value = flag(argv, name);
  if (!value)
    throw new WorkerError("CONFIG_INVALID", `${name} requires a value`);
  return value;
}

async function execute(argv: string[], repoRoot: string): Promise<JsonResult> {
  const [group, command] = argv;
  if (group === "config" && command === "validate") {
    const config = loadConfig();
    const lock = await readDiscoveryLock(
      resolve(repoRoot, "docs/discovery-lock.json"),
    );
    return {
      ok: true,
      chainId: 102031,
      chainKey: 3,
      cc3RpcUrl: config.cc3RpcUrl,
      proofServiceUrl: config.proofServiceUrl,
      decoder: lock.networks.cc3.decoder.address,
    };
  }

  if (group === "proof" && command === "inspect") {
    const path = requiredFlag(argv, "--file");
    const artifact = await readProofArtifact(resolve(process.cwd(), path));
    return {
      ok: true,
      source: artifact.source,
      decodedExpected: artifact.decodedExpected,
      integrity: verifyArtifactIntegrity(artifact),
    };
  }

  if (group === "proof" && command === "encode") {
    const input = requiredFlag(argv, "--file");
    const output = requiredFlag(argv, "--out");
    const artifact = await readProofArtifact(resolve(process.cwd(), input));
    const encoded = encodeAttestcoinProof(proofFromArtifact(artifact));
    const outputPath = resolve(process.cwd(), output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${encoded}\n`, "utf8");
    return {
      ok: true,
      out: output,
      byteLength: (encoded.length - 2) / 2,
      keccak256: encodedProofDigest(encoded),
    };
  }

  if (group === "proof" && command === "build") {
    const transactionHash = requiredFlag(argv, "--tx") as `0x${string}`;
    const receiptLogPosition = Number(
      requiredFlag(argv, "--receipt-log-position"),
    );
    const output = requiredFlag(argv, "--out");
    const result = await buildProofArtifact({
      transactionHash,
      receiptLogPosition,
      outPath: resolve(process.cwd(), output),
    });
    return {
      ok: true,
      out: output,
      rawOut: result.rawPath,
      source: result.artifact.source,
      canonicalJsonSha256: result.artifact.integrity.canonicalJsonSha256,
    };
  }

  if (group === "events" && command === "scan") {
    const fromBlock = Number(requiredFlag(argv, "--from-block"));
    const toBlock = Number(requiredFlag(argv, "--to-block"));
    const triggerFlag = flag(argv, "--trigger-below");
    const triggerBelow =
      triggerFlag === undefined ? undefined : BigInt(triggerFlag);
    const events = await scanAnswerUpdatedEvents({
      fromBlock,
      toBlock,
      triggerBelow,
    });
    return {
      ok: true,
      fromBlock,
      toBlock,
      triggerBelow: triggerBelow?.toString() ?? null,
      events,
    };
  }

  if (group === "proof" && command === "simulate") {
    const policyId = parsePolicyId(requiredFlag(argv, "--policy"));
    const firstArtifact = await readClaimArtifact(
      requiredFlag(argv, "--first-file"),
    );
    const confirmationArtifact = await readClaimArtifact(
      requiredFlag(argv, "--confirmation-file"),
    );
    try {
      const result = await simulateClaim({
        repoRoot,
        policyId,
        firstArtifact,
        confirmationArtifact,
      });
      return {
        ok: true,
        policyId: policyId.toString(),
        pool: result.poolAddress,
        calldataBytes: (result.call.data.length - 2) / 2,
        calldataKeccak256: claimArtifactDigest(result.call),
        gasEstimate: result.gasEstimate?.toString() ?? null,
        gasLimit: result.gasLimit?.toString() ?? null,
        gasHeadroomBps: result.gasHeadroomBps ?? null,
      };
    } catch (error) {
      if (error instanceof WorkerError) throw error;
      throw new WorkerError(
        "PROOF_SIMULATION_FAILED",
        "CC3 proof simulation failed",
        { retryable: true },
      );
    }
  }

  if (group === "proof" && command === "submit") {
    const policyId = parsePolicyId(requiredFlag(argv, "--policy"));
    const firstArtifact = await readClaimArtifact(
      requiredFlag(argv, "--first-file"),
    );
    const confirmationArtifact = await readClaimArtifact(
      requiredFlag(argv, "--confirmation-file"),
    );
    try {
      const result = await submitClaim({
        repoRoot,
        policyId,
        firstArtifact,
        confirmationArtifact,
      });
      return {
        ok: true,
        policyId: policyId.toString(),
        pool: result.poolAddress,
        relayer: result.relayer,
        transactionHash: result.hash,
        blockNumber: result.receipt.blockNumber.toString(),
        gasUsed: result.receipt.gasUsed.toString(),
        calldataBytes: (result.call.data.length - 2) / 2,
        calldataKeccak256: claimArtifactDigest(result.call),
        gasEstimate: result.gasEstimate?.toString() ?? null,
        gasLimit: result.gasLimit?.toString() ?? null,
        gasHeadroomBps: result.gasHeadroomBps ?? null,
      };
    } catch (error) {
      if (error instanceof WorkerError) throw error;
      throw new WorkerError(
        "PROOF_SUBMISSION_FAILED",
        "CC3 proof submission failed",
        { retryable: true },
      );
    }
  }
  throw new WorkerError(
    "CONFIG_INVALID",
    "usage: pegshield <config|proof> <command> ...",
  );
}

export async function runCli(
  argv: string[] = process.argv.slice(2),
  repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url))),
): Promise<number> {
  try {
    const result = await execute(argv, repoRoot);
    console.log(JSON.stringify(result));
    return 0;
  } catch (error) {
    const result = stableError(error);
    console.error(result.error.message);
    console.log(JSON.stringify(result));
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().then((code) => (process.exitCode = code));
}
