import { existsSync } from "node:fs";

if (!existsSync("contracts/out")) {
  console.log("generation deferred: contracts have not been built yet");
  process.exit(0);
}

console.log(
  "generation scaffold ready; protocol ABI generation begins after G2",
);
