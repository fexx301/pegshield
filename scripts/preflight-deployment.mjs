import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const CC3_CHAIN_ID = 102031;
const ETHEREUM_CHAIN_ID = 1;
const DEFAULT_RPC = "https://rpc.cc3-testnet.creditcoin.network";
const DEFAULT_ETHEREUM_RPC = "https://ethereum-rpc.publicnode.com";
const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);
const {
  createPublicClient,
  http,
  keccak256,
  encodeFunctionData,
  encodeAbiParameters,
} = require(resolve(repoRoot, "worker/node_modules/viem/_cjs/index.js"));
const lock = JSON.parse(
  readFileSync(resolve(repoRoot, "docs/discovery-lock.json"), "utf8"),
);
const rpcUrl = process.env.CC3_RPC_URL ?? DEFAULT_RPC;
const chain = {
  id: CC3_CHAIN_ID,
  name: "Creditcoin CC3 testnet",
  nativeCurrency: { name: "Creditcoin", symbol: "CTC", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};

const client = createPublicClient({ chain, transport: http(rpcUrl) });
const ethereumRpcUrl = process.env.ETHEREUM_RPC_URL ?? DEFAULT_ETHEREUM_RPC;
const ethereumClient = createPublicClient({
  chain: {
    id: ETHEREUM_CHAIN_ID,
    name: "Ethereum mainnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [ethereumRpcUrl] } },
  },
  transport: http(ethereumRpcUrl),
});

function fail(message, details = {}) {
  console.error(
    JSON.stringify({ ok: false, error: message, details }, null, 2),
  );
  process.exit(1);
}

const BLOCK_PROVER_ABI = [
  {
    type: "function",
    name: "verify",
    stateMutability: "view",
    inputs: [
      { name: "chainKey", type: "uint64" },
      { name: "height", type: "uint64" },
      { name: "encodedTransaction", type: "bytes" },
      {
        name: "merkleProof",
        type: "tuple",
        components: [
          { name: "root", type: "bytes32" },
          {
            name: "siblings",
            type: "tuple[]",
            components: [
              { name: "hash", type: "bytes32" },
              { name: "isLeft", type: "bool" },
            ],
          },
        ],
      },
      {
        name: "continuityProof",
        type: "tuple",
        components: [
          { name: "lowerEndpointDigest", type: "bytes32" },
          { name: "roots", type: "bytes32[]" },
        ],
      },
    ],
    outputs: [{ name: "valid", type: "bool" }],
  },
];

async function main() {
  const chainId = await client.getChainId();
  if (chainId !== CC3_CHAIN_ID)
    fail("CC3 chain ID mismatch", { expected: CC3_CHAIN_ID, actual: chainId });
  const ethereumChainId = await ethereumClient.getChainId();
  if (ethereumChainId !== ETHEREUM_CHAIN_ID)
    fail("Ethereum RPC chain ID mismatch", {
      expected: ETHEREUM_CHAIN_ID,
      actual: ethereumChainId,
    });

  const dependencies = {
    blockProver: lock.networks.cc3.blockProver,
    chainInfo: lock.networks.cc3.chainInfo,
    decoder: lock.networks.cc3.decoder,
  };
  const checks = {};
  for (const [name, dependency] of Object.entries(dependencies)) {
    const bytecode = await client.getBytecode({ address: dependency.address });
    const actualCodeHash =
      bytecode && bytecode !== "0x" ? keccak256(bytecode) : null;
    if (!actualCodeHash && dependency.codeHash)
      fail(`${name} has no runtime code`, { address: dependency.address });
    if (
      dependency.codeHash &&
      actualCodeHash &&
      actualCodeHash.toLowerCase() !== dependency.codeHash.toLowerCase()
    ) {
      fail(`${name} code hash mismatch`, {
        address: dependency.address,
        expected: dependency.codeHash,
        actual: actualCodeHash,
      });
    }
    checks[name] = {
      address: dependency.address,
      codeHash: actualCodeHash,
      precompile: actualCodeHash === null,
    };
  }
  const aggregatorBytecode = await ethereumClient.getBytecode({
    address: lock.networks.ethereum.underlyingAggregator,
  });
  const aggregatorCodeHash =
    aggregatorBytecode && aggregatorBytecode !== "0x"
      ? keccak256(aggregatorBytecode)
      : null;
  if (
    !aggregatorCodeHash ||
    aggregatorCodeHash.toLowerCase() !==
      lock.networks.ethereum.aggregatorCodeHash.toLowerCase()
  ) {
    fail("Ethereum aggregator code hash mismatch", {
      address: lock.networks.ethereum.underlyingAggregator,
    });
  }
  checks.sourceAggregator = {
    address: lock.networks.ethereum.underlyingAggregator,
    codeHash: aggregatorCodeHash,
    precompile: false,
  };

  const chainInfo = await client.readContract({
    address: dependencies.chainInfo.address,
    abi: [
      {
        type: "function",
        name: "get_latest_attestation_height_and_hash",
        stateMutability: "view",
        inputs: [{ name: "chainKey", type: "uint64" }],
        outputs: [
          {
            type: "tuple",
            components: [
              { name: "height", type: "uint64" },
              { name: "hash", type: "bytes32" },
              { name: "isAttestation", type: "bool" },
              { name: "exists", type: "bool" },
            ],
          },
        ],
      },
    ],
    functionName: "get_latest_attestation_height_and_hash",
    args: [3n],
  });
  if (!chainInfo.exists) fail("ChainInfo has no attestation for chain key 3");

  const fixturePath = resolve(
    repoRoot,
    "worker/fixtures/historical-proof.json",
  );
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  if (fixture.proof.chainKey !== 3) {
    fail("committed fixture is not pinned to Attestcoin chain key 3");
  }
  const proofArgs = [
    BigInt(fixture.proof.chainKey),
    BigInt(fixture.proof.headerNumber),
    fixture.proof.txBytes,
    {
      root: fixture.proof.merkleProof.root,
      siblings: fixture.proof.merkleProof.siblings,
    },
    {
      lowerEndpointDigest: fixture.proof.continuityProof.lowerEndpointDigest,
      roots: fixture.proof.continuityProof.roots,
    },
  ];
  const probeData = encodeFunctionData({
    abi: BLOCK_PROVER_ABI,
    functionName: "verify",
    args: proofArgs,
  });
  const probe = await client.call({
    to: dependencies.blockProver.address,
    data: probeData,
  });
  if (!probe.data || probe.data.length !== 66 || BigInt(probe.data) !== 1n) {
    fail("BlockProver rejected the committed fixture", {
      callSucceeded: Boolean(probe.data),
    });
  }

  const decoderProbeBytes =
    process.env.ATTESTCOIN_PROBE_TX_BYTES ?? fixture.proof.txBytes;
  const decoderType = await client.readContract({
    address: dependencies.decoder.address,
    abi: [
      {
        type: "function",
        name: "getTransactionType",
        stateMutability: "view",
        inputs: [{ type: "bytes" }],
        outputs: [{ type: "uint8" }],
      },
    ],
    functionName: "getTransactionType",
    args: [decoderProbeBytes],
  });
  if (decoderType !== lock.networks.cc3.decoder.fixtureTransactionType) {
    fail("decoder returned an unexpected fixture transaction type", {
      expected: lock.networks.cc3.decoder.fixtureTransactionType,
      actual: decoderType,
    });
  }

  // Exercise the deployed adapter's compiled call path (verifySourceLog)
  // against the live BlockProver precompile with the committed fixture.
  // Unit tests bind a bytecode mock and Foundry cannot execute CC3 host
  // precompiles, so this read-only probe is the only automated check of
  // the deployed adapter -> precompile boundary.
  const adapterAddress = process.env.ADAPTER_ADDRESS;
  let adapterProbe = "skipped (ADAPTER_ADDRESS not set)";
  if (adapterAddress) {
    const adapterProbeData = encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "verifySourceLog",
          stateMutability: "view",
          inputs: [
            { name: "encodedProof", type: "bytes" },
            { name: "receiptLogPosition", type: "uint256" },
          ],
          outputs: [{ name: "source", type: "bytes" }],
        },
      ],
      functionName: "verifySourceLog",
      args: [
        // The adapter's encodedProof parameter is the ABI-encoded proof
        // tuple itself (the same shape worker proofEncoder produces), not
        // verify() calldata.
        encodeAbiParameters(
          [
            { name: "chainKey", type: "uint64" },
            { name: "height", type: "uint64" },
            { name: "encodedTransaction", type: "bytes" },
            {
              name: "merkleProof",
              type: "tuple",
              components: [
                { name: "root", type: "bytes32" },
                {
                  name: "siblings",
                  type: "tuple[]",
                  components: [
                    { name: "hash", type: "bytes32" },
                    { name: "isLeft", type: "bool" },
                  ],
                },
              ],
            },
            {
              name: "continuityProof",
              type: "tuple",
              components: [
                { name: "lowerEndpointDigest", type: "bytes32" },
                { name: "roots", type: "bytes32[]" },
              ],
            },
          ],
          proofArgs,
        ),
        BigInt(lock.fixture.receiptLogPosition),
      ],
    });
    let probeResult;
    try {
      probeResult = await client.call({
        to: adapterAddress,
        data: adapterProbeData,
      });
    } catch (error) {
      // A fixture whose continuity proof has aged out of CC3's attestation
      // window fails here even on a healthy adapter: report it as stale
      // evidence, not as a broken proof boundary.
      fail("adapter fixture probe failed (fixture continuity may be stale)", {
        adapterAddress,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (!probeResult.data || probeResult.data === "0x") {
      fail("adapter fixture probe returned no data", { adapterAddress });
    }
    adapterProbe = "verified (fixture authenticated through deployed adapter)";
  }

  const manifestPath = resolve(
    repoRoot,
    process.env.DEPLOYMENT_MANIFEST ?? "deployments/cc3-testnet.json",
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        chainId,
        dependencies: checks,
        latestAttestationHeight: chainInfo.height.toString(),
        blockProverFixtureVerified: true,
        decoderType,
        adapterProbe,
        deploymentManifestPresent: existsSync(manifestPath),
        next: existsSync(manifestPath)
          ? `validate ${manifestPath.replace(`${repoRoot}/`, "")} and compare runtime hashes`
          : "deploy credentials are not configured; no CC3 state was changed",
      },
      null,
      2,
    ),
  );
}

main().catch((error) =>
  fail("deployment preflight failed", {
    message: error instanceof Error ? error.message : String(error),
  }),
);
