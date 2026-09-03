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
    signature: "submitBreachProof(uint256,bytes,uint256)",
    stateMutability: "nonpayable",
    inputs: [uint256, tuple("bytes"), uint256],
    outputs: [],
  },
  {
    signature: "submitConfirmationProof(uint256,bytes,uint256)",
    stateMutability: "nonpayable",
    inputs: [uint256, tuple("bytes"), uint256],
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

const webSource = readFileSync(resolve(repoRoot, "web/lib/chain.ts"), "utf8");
for (const expected of poolExpected) {
  const name = expected.signature.slice(0, expected.signature.indexOf("("));
  if (!webSource.includes(`name: "${name}"`)) {
    throw new Error(`web ABI is missing ${name}`);
  }
}
const workerSource = readFileSync(
  resolve(repoRoot, "worker/src/cc3Client.ts"),
  "utf8",
);
for (const expected of claimExpected) {
  const name = expected.signature.slice(0, expected.signature.indexOf("("));
  if (!workerSource.includes(`name: "${name}"`)) {
    throw new Error(`worker ABI is missing ${name}`);
  }
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
