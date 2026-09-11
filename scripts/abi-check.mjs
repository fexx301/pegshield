import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const poolArtifactPath = resolve(
  repoRoot,
  "contracts/out/PegShieldPool.sol/PegShieldPool.json",
);
const adapterArtifactPath = resolve(
  repoRoot,
  "contracts/out/AttestcoinVerifierAdapter.sol/AttestcoinVerifierAdapter.json",
);

function signature(entry) {
  return `${entry.name}(${(entry.inputs ?? []).map((input) => input.type).join(",")})`;
}

function tupleTypes(parameter) {
  return {
    type: parameter.type,
    components: (parameter.components ?? []).map(tupleTypes),
  };
}

function assertFunction(abi, expected) {
  const entry = abi.find(
    (candidate) =>
      candidate.type === "function" &&
      signature(candidate) === expected.signature,
  );
  if (!entry) throw new Error(`missing ABI function ${expected.signature}`);
  if (entry.stateMutability !== expected.stateMutability) {
    throw new Error(`ABI mutability drift for ${expected.signature}`);
  }
  const actualInputs = (entry.inputs ?? []).map(tupleTypes);
  const actualOutputs = (entry.outputs ?? []).map(tupleTypes);
  if (JSON.stringify(actualInputs) !== JSON.stringify(expected.inputs)) {
    throw new Error(`ABI input drift for ${expected.signature}`);
  }
  if (JSON.stringify(actualOutputs) !== JSON.stringify(expected.outputs)) {
    throw new Error(`ABI output drift for ${expected.signature}`);
  }
}

function readArtifact(path) {
  return JSON.parse(readFileSync(path, "utf8")).abi;
}

const tuple = (type, components = []) => ({ type, components });
const uint256 = tuple("uint256");
const address = tuple("address");
const uint8 = tuple("uint8");
const uint64 = tuple("uint64");
const uint32 = tuple("uint32");
const int256 = tuple("int256");
const bool = tuple("bool");
const bytes32 = tuple("bytes32");

const product = tuple("tuple", [
  uint256,
  address,
  uint8,
  int256,
  uint64,
  uint64,
  uint64,
  uint64,
  uint32,
  uint256,
  bool,
]);
const policy = tuple("tuple", [
  uint256,
  address,
  address,
  uint256,
  uint256,
  uint64,
  uint64,
  uint64,
  uint64,
  uint256,
  bytes32,
  uint8,
]);

const poolExpected = [
  {
    signature: "accountedCapital()",
    stateMutability: "view",
    inputs: [],
    outputs: [uint256],
  },
  {
    signature: "reservedCapital()",
    stateMutability: "view",
    inputs: [],
    outputs: [uint256],
  },
  {
    signature: "nextPolicyId()",
    stateMutability: "view",
    inputs: [],
    outputs: [uint256],
  },
  {
    signature: "quotePremium(uint256,uint256)",
    stateMutability: "view",
    inputs: [uint256, uint256],
    outputs: [uint256],
  },
  {
    signature: "getProduct(uint256)",
    stateMutability: "view",
    inputs: [uint256],
    outputs: [product],
  },
  {
    signature: "getPolicy(uint256)",
    stateMutability: "view",
    inputs: [uint256],
    outputs: [policy],
  },
  {
    signature: "buyPolicy(uint256,uint256,address)",
    stateMutability: "nonpayable",
    inputs: [uint256, uint256, address],
    outputs: [uint256],
  },
];

const claimExpected = [
  {
    signature: "submitClaim(uint256,bytes,uint256,bytes,uint256)",
    stateMutability: "nonpayable",
    inputs: [uint256, tuple("bytes"), uint256, tuple("bytes"), uint256],
    outputs: [],
  },
];

const adapterExpected = {
  signature: "verifySourceLog(bytes,uint256)",
  stateMutability: "view",
  inputs: [tuple("bytes"), uint256],
  outputs: [
    tuple("tuple", [
      uint256,
      bytes32,
      uint256,
      address,
      tuple("bytes32[]"),
      tuple("bytes"),
      bool,
    ]),
  ],
};

const poolAbi = readArtifact(poolArtifactPath);
const adapterAbi = readArtifact(adapterArtifactPath);
for (const expected of poolExpected) assertFunction(poolAbi, expected);
for (const expected of claimExpected) assertFunction(poolAbi, expected);
assertFunction(adapterAbi, adapterExpected);

// The TS-side ABI constants are the source of truth for what the web and
// worker actually encode, so parse them out of the module text instead of
// trusting a name substring to appear somewhere in the file. Each export is
// a `const X = [ ... ] as const;` array of viem ABI entries.
function extractAbiExport(source, exportName) {
  const anchor = source.indexOf(`const ${exportName} = [`);
  if (anchor < 0) throw new Error(`ABI export ${exportName} not found`);
  let depth = 0;
  let end = -1;
  for (
    let i = anchor + `const ${exportName} = `.length;
    i < source.length;
    i++
  ) {
    const ch = source[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error(`ABI export ${exportName} is malformed`);
  const body = source.slice(anchor + `const ${exportName} = `.length, end + 1);
  return eval(`(${body})`);
}

function assertTsAbiEntry(abi, expected, label) {
  const entry = abi.find(
    (candidate) =>
      candidate.type === "function" &&
      signature(candidate) === expected.signature,
  );
  if (!entry) throw new Error(`${label} ABI is missing ${expected.signature}`);
  if (entry.stateMutability !== expected.stateMutability) {
    throw new Error(`${label} ABI mutability drift for ${expected.signature}`);
  }
  const actualInputs = (entry.inputs ?? []).map(tupleTypes);
  const actualOutputs = (entry.outputs ?? []).map(tupleTypes);
  if (JSON.stringify(actualInputs) !== JSON.stringify(expected.inputs)) {
    throw new Error(`${label} ABI input drift for ${expected.signature}`);
  }
  if (JSON.stringify(actualOutputs) !== JSON.stringify(expected.outputs)) {
    throw new Error(`${label} ABI output drift for ${expected.signature}`);
  }
}

const webSource = readFileSync(resolve(repoRoot, "web/lib/chain.ts"), "utf8");
const webAbi = [
  ...extractAbiExport(webSource, "POOL_READ_ABI"),
  ...extractAbiExport(webSource, "POOL_WRITE_ABI"),
  ...extractAbiExport(webSource, "CLAIM_WRITE_ABI"),
];
for (const expected of poolExpected) {
  assertTsAbiEntry(webAbi, expected, "web");
}
for (const expected of claimExpected) {
  assertTsAbiEntry(webAbi, expected, "web");
}

const workerSource = readFileSync(
  resolve(repoRoot, "worker/src/cc3Client.ts"),
  "utf8",
);
const workerAbi = extractAbiExport(workerSource, "CLAIM_ABI");
for (const expected of claimExpected) {
  assertTsAbiEntry(workerAbi, expected, "worker");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      poolFunctions: poolExpected.map((entry) => entry.signature),
      claimFunctions: claimExpected.map((entry) => entry.signature),
      adapterFunction: adapterExpected.signature,
    },
    null,
    2,
  ),
);
