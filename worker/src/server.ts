import { mkdtemp, rm } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProofArtifact } from "./proofBuilder.js";
import { WorkerError, stableError } from "./errors.js";
import type { ProofArtifact } from "./types.js";

const MAX_BODY_BYTES = 32 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024;
const WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 20;
const DEFAULT_MAX_CACHE_ENTRIES = 256;
const DEFAULT_MAX_RATE_ENTRIES = 1_024;
const DEFAULT_MAX_CONCURRENT_BUILDS = 4;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;

export type ProofRequest = {
  transactionHash: `0x${string}`;
  receiptLogPosition: number;
};

type BuildResult = Awaited<ReturnType<typeof buildProofArtifact>>;
type BuildFunction = (options: {
  transactionHash: `0x${string}`;
  receiptLogPosition: number;
  outPath: string;
}) => Promise<BuildResult>;

type CacheEntry = { expiresAt: number; artifact: ProofArtifact };
type RateEntry = { startedAt: number; count: number };

export type ProofServerOptions = {
  build?: BuildFunction;
  now?: () => number;
  tempRoot?: string;
  requestTimeoutMs?: number;
  maxRequestsPerWindow?: number;
  maxCacheEntries?: number;
  maxRateEntries?: number;
  maxConcurrentBuilds?: number;
  trustProxy?: boolean;
  trustedProxyAddresses?: readonly string[];
};

type ServerState = {
  build: BuildFunction;
  now: () => number;
  tempRoot: string;
  requestTimeoutMs: number;
  maxRequestsPerWindow: number;
  maxCacheEntries: number;
  maxRateEntries: number;
  maxConcurrentBuilds: number;
  trustProxy: boolean;
  trustedProxyAddresses: Set<string>;
  cache: Map<string, CacheEntry>;
  inFlight: Map<string, Promise<BuildResult>>;
  rate: Map<string, RateEntry>;
  activeBuilds: number;
};

export function validateProofRequest(value: unknown): ProofRequest {
  if (value === null || typeof value !== "object") {
    throw new WorkerError(
      "PROOF_INVALID",
      "request body must be a JSON object",
    );
  }
  const body = value as Record<string, unknown>;
  const transactionHash = body.transactionHash;
  const receiptLogPosition = body.receiptLogPosition;
  if (
    typeof transactionHash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)
  ) {
    throw new WorkerError(
      "PROOF_INVALID",
      "transactionHash must be a 32-byte hex hash",
    );
  }
  if (
    typeof receiptLogPosition !== "number" ||
    !Number.isSafeInteger(receiptLogPosition) ||
    receiptLogPosition < 0 ||
    receiptLogPosition > 10_000
  ) {
    throw new WorkerError(
      "PROOF_INVALID",
      "receiptLogPosition must be an integer from 0 to 10000",
    );
  }
  return {
    transactionHash: transactionHash as `0x${string}`,
    receiptLogPosition,
  };
}

export function createProofServer(options: ProofServerOptions = {}): Server {
  const state: ServerState = {
    build: options.build ?? buildProofArtifact,
    now: options.now ?? Date.now,
    tempRoot: options.tempRoot ?? tmpdir(),
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    maxRequestsPerWindow:
      options.maxRequestsPerWindow ?? DEFAULT_MAX_REQUESTS_PER_WINDOW,
    maxCacheEntries: options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES,
    maxRateEntries: options.maxRateEntries ?? DEFAULT_MAX_RATE_ENTRIES,
    maxConcurrentBuilds:
      options.maxConcurrentBuilds ?? DEFAULT_MAX_CONCURRENT_BUILDS,
    trustProxy:
      options.trustProxy ?? process.env.PROOF_SERVICE_TRUST_PROXY === "true",
    trustedProxyAddresses: new Set(
      (
        options.trustedProxyAddresses ?? [
          "127.0.0.1",
          "::1",
          "::ffff:127.0.0.1",
        ]
      ).map(normalizeAddress),
    ),
    cache: new Map(),
    inFlight: new Map(),
    rate: new Map(),
    activeBuilds: 0,
  };

  return createServer(async (request, response) => {
    try {
      await handleRequest(request, response, state);
    } catch {
      // Never serialize an arbitrary upstream or filesystem error. In
      // particular, those errors can contain credential-bearing RPC URLs.
      sendJson(response, 500, {
        ok: false,
        error: {
          code: "PROOF_SERVICE_FAILED",
          message: "internal proof service error",
          retryable: true,
          details: {},
        },
      });
    }
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: ServerState,
): Promise<void> {
  if (request.method !== "POST" || request.url !== "/api/proofs") {
    sendJson(response, 404, {
      ok: false,
      error: { code: "NOT_FOUND", message: "route not found" },
    });
    return;
  }

  const now = state.now();
  const clientKey = clientIdentity(request, state);
  if (
    !allowRequest(
      clientKey,
      state.rate,
      now,
      state.maxRequestsPerWindow,
      state.maxRateEntries,
    )
  ) {
    sendJson(response, 429, {
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: "proof requests are temporarily rate limited",
        retryable: true,
        details: {},
      },
    });
    return;
  }

  let body: string;
  try {
    body = await readBody(request, state.requestTimeoutMs);
  } catch (error) {
    const timeout =
      error instanceof WorkerError && error.code === "PROOF_TIMEOUT";
    sendJson(response, timeout ? 408 : 400, safeWorkerError(error));
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendJson(response, 400, {
      ok: false,
      error: {
        code: "PROOF_INVALID",
        message: "request body is not valid JSON",
        retryable: false,
        details: {},
      },
    });
    return;
  }

  let proofRequest: ProofRequest;
  try {
    proofRequest = validateProofRequest(parsed);
  } catch (error) {
    sendJson(response, 400, safeWorkerError(error));
    return;
  }

  const cacheKey = `3:${proofRequest.transactionHash.toLowerCase()}:${proofRequest.receiptLogPosition}`;
  pruneExpiredCache(state.cache, state.now());
  const cached = state.cache.get(cacheKey);
  if (cached && cached.expiresAt > state.now()) {
    // Refresh insertion order so the cache behaves as a bounded LRU.
    state.cache.delete(cacheKey);
    state.cache.set(cacheKey, cached);
    sendJson(response, 200, {
      ok: true,
      cached: true,
      artifact: cached.artifact,
    });
    return;
  }

  const requestId = randomUUID();
  let pending = state.inFlight.get(cacheKey);
  if (!pending) {
    if (state.activeBuilds >= state.maxConcurrentBuilds) {
      sendJson(response, 503, {
        ok: false,
        error: {
          code: "PROOF_CAPACITY",
          message: "proof service is at capacity; retry shortly",
          retryable: true,
          details: {},
        },
      });
      return;
    }

    state.activeBuilds += 1;
    const build = runBuildWithTempDir(state, {
      transactionHash: proofRequest.transactionHash,
      receiptLogPosition: proofRequest.receiptLogPosition,
    });
    state.inFlight.set(cacheKey, build);
    // Cache population and in-flight eviction follow the build's own
    // settlement, never an awaiting request's. A request that times out
    // must leave the build in flight so retries join the same promise
    // instead of spawning a duplicate that consumes another build slot.
    const settle = () => {
      if (state.inFlight.get(cacheKey) === build) {
        state.inFlight.delete(cacheKey);
      }
    };
    void build.then((result) => {
      setCacheEntry(
        cacheKey,
        result.artifact,
        state.cache,
        state.now() + DEFAULT_CACHE_TTL_MS,
        state.maxCacheEntries,
      );
      settle();
    }, settle);
    pending = build;
  }
  try {
    const result = await withTimeout(
      pending,
      state.requestTimeoutMs,
      "proof generation timed out",
    );
    sendJson(response, 200, {
      ok: true,
      cached: false,
      requestId,
      artifact: result.artifact,
    });
  } catch (error) {
    sendBuildFailure(response, error);
  }
}

async function runBuildWithTempDir(
  state: ServerState,
  request: ProofRequest,
): Promise<BuildResult> {
  let tempDir: string;
  try {
    tempDir = await mkdtemp(join(state.tempRoot, "pegshield-"));
  } catch {
    state.activeBuilds -= 1;
    throw new WorkerError(
      "PROOF_CAPACITY",
      "proof service cannot allocate temporary storage",
      { retryable: true },
    );
  }
  try {
    return await state.build({
      transactionHash: request.transactionHash,
      receiptLogPosition: request.receiptLogPosition,
      outPath: join(tempDir, "proof.json"),
    });
  } finally {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } finally {
      state.activeBuilds -= 1;
    }
  }
}

function sendBuildFailure(response: ServerResponse, error: unknown): void {
  if (error instanceof WorkerError && error.code === "PROOF_CAPACITY") {
    sendJson(response, 503, {
      ok: false,
      error: {
        code: "PROOF_CAPACITY",
        message: "proof service cannot allocate temporary storage",
        retryable: true,
        details: {},
      },
    });
    return;
  }
  if (error instanceof WorkerError && error.code === "PROOF_TIMEOUT") {
    sendJson(response, 504, {
      ok: false,
      error: {
        code: "PROOF_TIMEOUT",
        message: "proof generation timed out; retry later",
        retryable: true,
        details: {},
      },
    });
    return;
  }
  if (error instanceof WorkerError && error.code === "SOURCE_NOT_FOUND") {
    sendJson(response, 404, {
      ok: false,
      error: {
        code: "SOURCE_NOT_FOUND",
        message: "source receipt log was not found",
        retryable: false,
        details: {},
      },
    });
    return;
  }
  if (error instanceof WorkerError && error.code === "SOURCE_INELIGIBLE") {
    sendJson(response, 422, {
      ok: false,
      error: {
        code: "SOURCE_INELIGIBLE",
        message: "source receipt does not match the locked feed",
        retryable: false,
        details: {},
      },
    });
    return;
  }
  sendJson(response, 502, {
    ok: false,
    error: {
      code: "PROOF_SERVICE_FAILED",
      message: "proof generation failed; retry later",
      retryable: true,
      details: {},
    },
  });
}

function safeWorkerError(error: unknown): ReturnType<typeof stableError> {
  if (error instanceof WorkerError) return error.toJSON();
  return new WorkerError(
    "PROOF_INVALID",
    "request could not be processed",
  ).toJSON();
}

function clientIdentity(request: IncomingMessage, state: ServerState): string {
  const peer = normalizeAddress(request.socket?.remoteAddress ?? "unknown");
  if (state.trustProxy && state.trustedProxyAddresses.has(peer)) {
    const forwardedFor = request.headers["x-forwarded-for"];
    const firstForwarded = (
      Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor
    )
      ?.split(",")[0]
      ?.trim();
    if (firstForwarded) return normalizeAddress(firstForwarded);
  }
  return peer || "unknown";
}

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

function allowRequest(
  key: string,
  entries: Map<string, RateEntry>,
  timestamp: number,
  maxRequestsPerWindow: number,
  maxEntries: number,
): boolean {
  for (const [entryKey, entry] of entries) {
    if (timestamp - entry.startedAt >= WINDOW_MS) entries.delete(entryKey);
  }
  const current = entries.get(key);
  if (!current) {
    if (entries.size >= maxEntries) return false;
    entries.set(key, { startedAt: timestamp, count: 1 });
    return true;
  }
  if (current.count >= maxRequestsPerWindow) return false;
  current.count += 1;
  return true;
}

function pruneExpiredCache(
  cache: Map<string, CacheEntry>,
  timestamp: number,
): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= timestamp) cache.delete(key);
  }
}

function setCacheEntry(
  key: string,
  artifact: ProofArtifact,
  cache: Map<string, CacheEntry>,
  expiresAt: number,
  maxEntries: number,
): void {
  cache.delete(key);
  while (cache.size >= maxEntries) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
  cache.set(key, { artifact, expiresAt });
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new WorkerError("PROOF_TIMEOUT", message, { retryable: true })),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readBody(
  request: IncomingMessage,
  timeoutMs: number,
): Promise<string> {
  const read = (async () => {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) {
        throw new WorkerError("PROOF_INVALID", "request body exceeds 32 KiB");
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  })();
  return withTimeout(read, timeoutMs, "request body timed out");
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
    response.statusCode = 502;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(
      JSON.stringify({
        ok: false,
        error: {
          code: "PROOF_SERVICE_FAILED",
          message: "proof response exceeds the service limit",
          retryable: false,
          details: {},
        },
      }),
    );
    return;
  }
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(body);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PROOF_SERVICE_PORT ?? 8787);
  const server = createProofServer();
  server.listen(port, "127.0.0.1", () => {
    process.stderr.write(
      `PegShield proof service listening on 127.0.0.1:${port}\n`,
    );
  });
}
