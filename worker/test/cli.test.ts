import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";

describe("cli dispatch", () => {
  it("exits non-zero naming the flag when its value is missing or another flag", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(runCli(["proof", "inspect", "--file"])).resolves.toBe(1);
      expect(errorSpy).toHaveBeenLastCalledWith("--file requires a value");

      await expect(
        runCli(["proof", "build", "--tx", "--out", "proof.json"]),
      ).resolves.toBe(1);
      expect(errorSpy).toHaveBeenLastCalledWith("--tx requires a value");
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
