import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/claim-service", () => ({
  discoverClaim: vi
    .fn()
    .mockRejectedValue(new Error("https://rpc.example/SECRET")),
  prepareClaim: vi.fn(),
}));
import { GET, POST } from "../app/api/claims/[policyId]/route";
describe("claim endpoint boundary", () => {
  it("rejects invalid policy IDs before network access", async () => {
    const response = await GET(
      new Request("https://pegshield.test/api/claims/0"),
      { params: Promise.resolve({ policyId: "0" }) },
    );
    expect(response.status).toBe(400);
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
    const response = await GET(
      new Request("https://pegshield.test/api/claims/1"),
      { params: Promise.resolve({ policyId: "1" }) },
    );
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("SECRET");
  });
});
