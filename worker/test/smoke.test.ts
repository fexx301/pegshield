import { describe, expect, it } from "vitest";
import { packageName } from "../src/index.js";

describe("worker scaffold", () => {
  it("exports the package name", () => {
    expect(packageName).toBe("@pegshield/worker");
  });
});
