import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { WorkerError } from "../src/errors.js";
import { createProofServer, validateProofRequest } from "../src/server.js";
import type { ProofArtifact } from "../src/types.js";

const VALID_REQUEST = {
  transactionHash: `0x${"11".repeat(32)}` as `0x${string}`,
  receiptLogPosition: 2,
};
const SECOND_REQUEST = {
  transactionHash: `0x${"22".repeat(32)}` as `0x${string}`,
  receiptLogPosition: 2,
};
const FAKE_ARTIFACT = {} as ProofArtifact;

class FakeResponse extends EventEmitter {
  statusCode = 0;
  body = "";
  headers = new Map<string, string>();

  setHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  end(body?: string): void {
    this.body = body ?? "";
    this.emit("finish");
  }
}

async function request(
  server: ReturnType<typeof createProofServer>,
  body: unknown,
  options: { remoteAddress?: string; forwardedFor?: string } = {},
): Promise<{ status: number; payload: Record<string, any>; body: string }> {
  const requestBody = typeof body === "string" ? body : JSON.stringify(body);
  const incoming = Readable.from([requestBody]) as unknown as IncomingMessage;
  Object.assign(incoming, {
    method: "POST",
    url: "/api/proofs",
    headers: options.forwardedFor
      ? { "x-forwarded-for": options.forwardedFor }
      : {},
    socket: { remoteAddress: options.remoteAddress ?? "127.0.0.1" },
  });
  const response = new FakeResponse();
  const finished = new Promise<{
    status: number;
    payload: Record<string, any>;
    body: string;
  }>((resolveResult) => {
    response.once("finish", () =>
      resolveResult({
        status: response.statusCode,
        payload: JSON.parse(response.body) as Record<string, any>,
        body: response.body,
      }),
    );
  });
  server.emit("request", incoming, response as unknown as ServerResponse);
  return finished;
}

function successfulBuild(paths: string[]) {
  return vi.fn(async ({ outPath }: { outPath: string }) => {
    paths.push(outPath);
    await writeFile(outPath, "normalized", "utf8");
    return {
      artifact: FAKE_ARTIFACT,
      proofPath: outPath,
      rawPath: `${outPath}.raw.json`,
    };
  });
}

describe("proof service boundary", () => {
  it("accepts only a transaction hash and bounded receipt-local position", () => {
    expect(validateProofRequest(VALID_REQUEST)).toEqual(VALID_REQUEST);
    expect(() =>
      validateProofRequest({
        transactionHash: "http://localhost",
        receiptLogPosition: 0,
      }),
    ).toThrow();
    expect(() =>
      validateProofRequest({
        transactionHash: VALID_REQUEST.transactionHash,
        receiptLogPosition: -1,
      }),
    ).toThrow();
    expect(() =>
      validateProofRequest({
        transactionHash: VALID_REQUEST.transactionHash,
        receiptLogPosition: 1.5,
      }),
    ).toThrow();
  });

  it("deduplicates builds, caches results, and removes the temporary directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "pegshield-server-test-"));
    const paths: string[] = [];
    const build = successfulBuild(paths);
    const server = createProofServer({ build, tempRoot: root });

    const [first, second] = await Promise.all([
      request(server, VALID_REQUEST),
      request(server, VALID_REQUEST),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(build).toHaveBeenCalledTimes(1);
    expect(paths).toHaveLength(1);
    await expect(access(dirname(paths[0]))).rejects.toThrow();

    const cached = await request(server, VALID_REQUEST);
    expect(cached.status).toBe(200);
    expect(cached.payload.cached).toBe(true);
    expect(build).toHaveBeenCalledTimes(1);
    await rm(root, { recursive: true, force: true });
  });

  it("does not trust spoofed forwarded identities unless the peer is trusted", async () => {
    const paths: string[] = [];
    const build = successfulBuild(paths);
    const server = createProofServer({
      build,
      maxRequestsPerWindow: 1,
      trustProxy: false,
    });
    expect(
      (await request(server, VALID_REQUEST, { forwardedFor: "198.51.100.1" }))
        .status,
    ).toBe(200);
    expect(
      (await request(server, SECOND_REQUEST, { forwardedFor: "198.51.100.2" }))
        .status,
    ).toBe(429);
  });

  it("honors forwarded identities only from an explicitly trusted peer", async () => {
    const paths: string[] = [];
    const build = successfulBuild(paths);
    const server = createProofServer({
      build,
      maxRequestsPerWindow: 1,
      trustProxy: true,
      trustedProxyAddresses: ["10.0.0.2"],
    });
    expect(
      (
        await request(server, VALID_REQUEST, {
          remoteAddress: "10.0.0.2",
          forwardedFor: "198.51.100.1",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(server, SECOND_REQUEST, {
          remoteAddress: "10.0.0.2",
          forwardedFor: "198.51.100.2",
        })
      ).status,
    ).toBe(200);
  });

  it("rejects oversized bodies before starting a proof build", async () => {
    const build = successfulBuild([]);
    const server = createProofServer({ build });
    const result = await request(server, "x".repeat(32 * 1024 + 1));
    expect(result.status).toBe(400);
    expect(result.payload.error.code).toBe("PROOF_INVALID");
    expect(build).not.toHaveBeenCalled();
  });

  it("returns a bounded capacity error instead of starting excess work", async () => {
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolveStarted) => {
      started = resolveStarted;
    });
    const build = vi.fn(
      ({ outPath }: { outPath: string }) =>
        new Promise<{
          artifact: ProofArtifact;
          proofPath: string;
          rawPath: string;
        }>((resolveBuild) => {
          void writeFile(outPath, "normalized", "utf8");
          started();
          release = () =>
            resolveBuild({
              artifact: FAKE_ARTIFACT,
              proofPath: outPath,
              rawPath: `${outPath}.raw.json`,
            });
        }),
    );
    const server = createProofServer({
      build,
      maxConcurrentBuilds: 1,
      requestTimeoutMs: 1_000,
    });
    const first = request(server, VALID_REQUEST);
    await startedPromise;
    const second = await request(server, SECOND_REQUEST);
    expect(second.status).toBe(503);
    expect(second.payload.error.code).toBe("PROOF_CAPACITY");
    release();
    expect((await first).status).toBe(200);
  });

  it("never returns credential-bearing upstream errors", async () => {
    const server = createProofServer({
      build: vi.fn(async () => {
        throw new Error(
          "fetch failed https://user:super-secret@example.test/rpc",
        );
      }),
    });
    const result = await request(server, VALID_REQUEST);
    expect(result.status).toBe(502);
    expect(result.body).not.toContain("super-secret");
    expect(result.body).not.toContain("example.test");
  });

  it("rejects an oversized upstream artifact response", async () => {
    const oversized = {
      large: "x".repeat(128 * 1024),
    } as unknown as ProofArtifact;
    const server = createProofServer({
      build: vi.fn(async () => ({
        artifact: oversized,
        proofPath: "",
        rawPath: "",
      })),
    });
    const result = await request(server, VALID_REQUEST);
    expect(result.status).toBe(502);
    expect(result.payload.error.message).toMatch(/response exceeds/);
  });

  it("times out a hanging proof build with a stable public error", async () => {
    let release!: () => void;
    const server = createProofServer({
      requestTimeoutMs: 5,
      build: vi.fn(
        () =>
          new Promise((resolveBuild) => {
            release = () =>
              resolveBuild({
                artifact: FAKE_ARTIFACT,
                proofPath: "",
                rawPath: "",
              });
          }),
      ),
    });
    const result = await request(server, VALID_REQUEST);
    expect(result.status).toBe(504);
    expect(result.payload.error.code).toBe("PROOF_TIMEOUT");
    release();
  });

  it("keeps a slow build in flight for retries after a request times out", async () => {
    const root = await mkdtemp(join(tmpdir(), "pegshield-server-test-"));
    const paths: string[] = [];
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolveStarted) => {
      started = resolveStarted;
    });
    const build = vi.fn(
      ({ outPath }: { outPath: string }) =>
        new Promise<{
          artifact: ProofArtifact;
          proofPath: string;
          rawPath: string;
        }>((resolveBuild) => {
          paths.push(outPath);
          void writeFile(outPath, "normalized", "utf8");
          started();
          release = () =>
            resolveBuild({
              artifact: FAKE_ARTIFACT,
              proofPath: outPath,
              rawPath: `${outPath}.raw.json`,
            });
        }),
    );
    const server = createProofServer({
      build,
      tempRoot: root,
      maxConcurrentBuilds: 1,
      requestTimeoutMs: 40,
    });

    const first = request(server, VALID_REQUEST);
    await startedPromise;
    // Real-clock integration test: the request path interleaves the
    // server's own setTimeout with real stream reads and temp-dir
    // cleanup, so fake timers cannot reproduce the settlement ordering
    // under test. The delay spaces the joiner's timeout registration well
    // past the first request's; the shared build settles through temp-dir
    // cleanup after release, and a joiner registered in the same
    // millisecond could win its own timeout race against that cleanup.
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 20));
    const joiner = request(server, VALID_REQUEST);
    const timedOut = await first;
    expect(timedOut.status).toBe(504);
    expect(timedOut.payload.error.code).toBe("PROOF_TIMEOUT");

    // The retry must join the still-running build. Spawning a duplicate
    // would exceed the single build slot and answer 503 PROOF_CAPACITY.
    const retry = request(server, VALID_REQUEST);
    release();
    const [joinerResult, retryResult] = await Promise.all([joiner, retry]);
    expect(joinerResult.status).toBe(200);
    expect(retryResult.status).toBe(200);
    expect(build).toHaveBeenCalledTimes(1);
    expect(paths).toHaveLength(1);

    const cached = await request(server, VALID_REQUEST);
    expect(cached.status).toBe(200);
    expect(cached.payload.cached).toBe(true);
    expect(build).toHaveBeenCalledTimes(1);
    await rm(root, { recursive: true, force: true });
  });

  it("maps typed build failures to their stable HTTP responses", async () => {
    const notFound = await request(
      createProofServer({
        build: vi.fn(async () => {
          throw new WorkerError(
            "SOURCE_NOT_FOUND",
            "receiptLogPosition is outside the receipt",
          );
        }),
      }),
      VALID_REQUEST,
    );
    expect(notFound.status).toBe(404);
    expect(notFound.payload.error).toEqual({
      code: "SOURCE_NOT_FOUND",
      message: "source receipt log was not found",
      retryable: false,
      details: {},
    });

    const ineligible = await request(
      createProofServer({
        build: vi.fn(async () => {
          throw new WorkerError(
            "SOURCE_INELIGIBLE",
            "locked AnswerUpdated log shape is malformed",
          );
        }),
      }),
      VALID_REQUEST,
    );
    expect(ineligible.status).toBe(422);
    expect(ineligible.payload.error).toEqual({
      code: "SOURCE_INELIGIBLE",
      message: "source receipt does not match the locked feed",
      retryable: false,
      details: {},
    });

    const generic = await request(
      createProofServer({
        build: vi.fn(async () => {
          throw new Error("connection reset by peer");
        }),
      }),
      VALID_REQUEST,
    );
    expect(generic.status).toBe(502);
    expect(generic.payload.error).toEqual({
      code: "PROOF_SERVICE_FAILED",
      message: "proof generation failed; retry later",
      retryable: true,
      details: {},
    });
  });
});
