import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/claim-service", () => {
  class PolicyNotFoundError extends Error {}
  return {
    PolicyNotFoundError,
    discoverClaim: vi
      .fn()
      .mockRejectedValue(new Error("https://rpc.example/SECRET")),
    prepareClaim: vi.fn(),
  };
});
import { GET, POST } from "../app/api/claims/[policyId]/route";
import {
  discoverClaim,
  PolicyNotFoundError,
  prepareClaim,
} from "../lib/claim-service";

function get(policyId: string, identity?: string) {
  const headers = identity ? { "x-forwarded-for": identity } : undefined;
  return GET(
    new Request(`https://pegshield.test/api/claims/${policyId}`, { headers }),
    { params: Promise.resolve({ policyId }) },
  );
}

describe("claim endpoint boundary", () => {
  it("rejects invalid policy IDs before network access", async () => {
    expect((await get("0")).status).toBe(400);
  });
  it("rejects cross-origin proof preparation", async () => {
    const response = await POST(
      new Request("https://pegshield.test/api/claims/1", {
        method: "POST",
        headers: { origin: "https://other.test" },
      }),
      { params: Promise.resolve({ policyId: "1" }) },
    );
    expect(response.status).toBe(403);
  });
  it("never exposes upstream credentials in errors", async () => {
    const response = await get("1");
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("SECRET");
  });
  it("maps unknown policies to a 404 instead of a retryable 502", async () => {
    vi.mocked(discoverClaim).mockRejectedValueOnce(new PolicyNotFoundError());
    const response = await get("999");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Policy not found." });
  });
  it("rate limits public GET discovery per identity", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (let i = 0; i < 20; i++)
        expect((await get("2", "203.0.113.7")).status).toBe(502);
      expect((await get("2", "203.0.113.7")).status).toBe(429);
      // A different identity, and POST preparation, are unaffected.
      expect((await get("2", "198.51.100.4")).status).toBe(502);
      vi.mocked(prepareClaim).mockResolvedValueOnce({
        eligibility: {
          status: "first",
          observations: [],
          checkedAt: new Date().toISOString(),
        },
      });
      const response = await POST(
        new Request("https://pegshield.test/api/claims/2", {
          method: "POST",
          headers: { "x-forwarded-for": "203.0.113.7" },
        }),
        { params: Promise.resolve({ policyId: "2" }) },
      );
      expect(response.status).toBe(200);
    } finally {
      quiet.mockRestore();
    }
  });
  it("expires the GET rate-limit window", async () => {
    vi.useFakeTimers();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (let i = 0; i < 20; i++)
        expect((await get("3", "192.0.2.50")).status).toBe(502);
      expect((await get("3", "192.0.2.50")).status).toBe(429);
      vi.setSystemTime(Date.now() + 61_000);
      expect((await get("3", "192.0.2.50")).status).toBe(502);
    } finally {
      quiet.mockRestore();
      vi.useRealTimers();
    }
  });
  it("bounds tracked identities while still serving known ones", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let allowed = 0;
      for (let i = 0; i < 1100; i++) {
        if ((await get("5", `cap-${i}`)).status === 429) break;
        allowed++;
      }
      expect(allowed).toBeLessThanOrEqual(1024);
      expect(allowed).toBeGreaterThan(1000);
      expect((await get("1")).status).not.toBe(429);
    } finally {
      quiet.mockRestore();
    }
  });
});
