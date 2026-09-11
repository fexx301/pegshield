import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { proofProvider } from "@gluwa/usc-sdk";
import {
  createPublicClient,
  http,
  keccak256,
  type Address,
  type Hash,
  type Hex,
} from "viem";

const CC3_RPC_DEFAULT = "https://rpc.cc3-testnet.creditcoin.network";
const PROOF_URL_DEFAULT = "https://prover.cc3-testnet.creditcoin.network";
const CHAIN_KEY = 3;
const CC3_CHAIN_ID = 102031;
const SOURCE_CHAIN_ID = 1;
const BLOCK_PROVER = "0x0000000000000000000000000000000000000FD2" as Address;
const CHAIN_INFO = "0x0000000000000000000000000000000000000fd3" as Address;
const DECODER = "0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f" as Address;
const PROXY = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6" as Address;
const FIXTURE_TX =
  "0x60f65e8b0b14daf28495f367ed8f46ade4ebabec4e4b13c86a3f55a7b2f34245" as Hash;

const FEED_ABI = [
  {
    type: "function",
    name: "aggregator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "description",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

const CHAIN_INFO_ABI = [
  {
    type: "function",
    name: "get_chain_by_key",
    stateMutability: "view",
    inputs: [{ name: "chainKey", type: "uint64" }],
    outputs: [
      {
        name: "result",
        type: "tuple",
        components: [
          {
            name: "info",
            type: "tuple",
            components: [
              { name: "chainKey", type: "uint64" },
              { name: "chainId", type: "uint64" },
              { name: "chainName", type: "bytes" },
              { name: "chainEncoding", type: "uint8" },
            ],
          },
          { name: "exists", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "get_latest_attestation_height_and_hash",
    stateMutability: "view",
    inputs: [{ name: "chainKey", type: "uint64" }],
    outputs: [
      {
        name: "result",
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
] as const;

const DECODER_ABI = [
  {
    type: "function",
    name: "getTransactionType",
    stateMutability: "view",
    inputs: [{ name: "txBytes", type: "bytes" }],
    outputs: [{ type: "uint8" }],
  },
] as const;

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
    outputs: [{ type: "bool" }],
  },
] as const;

const CC3_CHAIN = {
  id: CC3_CHAIN_ID,
  name: "Creditcoin CC3 testnet",
  nativeCurrency: { name: "Creditcoin", symbol: "CTC", decimals: 18 },
  rpcUrls: { default: { http: [CC3_RPC_DEFAULT] } },
} as const;

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

function jsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonValue(item)]),
    );
  }
  return value;
}

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function hexToSigned(hex: Hex): bigint {
  const unsigned = BigInt(hex);
  const signBit = 1n << 255n;
  return unsigned >= signBit ? unsigned - (1n << 256n) : unsigned;
}

function lower(value: string): string {
  return value.toLowerCase();
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function codeHash(code: Hex | undefined): string | null {
  return code && code !== "0x" ? keccak256(code) : null;
}

async function rpcCode(
  client: ReturnType<typeof createPublicClient>,
  address: Address,
): Promise<Hex> {
  const request = client.request as unknown as (args: {
    method: "eth_getCode";
    params: [Address, "latest"];
  }) => Promise<Hex>;
  return request({ method: "eth_getCode", params: [address, "latest"] });
}

async function main(): Promise<void> {
  const cc3RpcUrl = env("CC3_RPC_URL", CC3_RPC_DEFAULT);
  const ethereumRpcUrl = env("ETHEREUM_RPC_URL");
  const proofUrl = env("ATTESTCOIN_PROVER_URL", PROOF_URL_DEFAULT);
  const now = new Date().toISOString();
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const discoveryGitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();

  const cc3 = createPublicClient({
    chain: CC3_CHAIN,
    transport: http(cc3RpcUrl),
  });
  const eth = createPublicClient({
    chain: {
      id: SOURCE_CHAIN_ID,
      name: "Ethereum mainnet",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [ethereumRpcUrl] } },
    },
    transport: http(ethereumRpcUrl),
  });

  const [cc3ChainId, cc3LatestBlock, ethereumChainId] = await Promise.all([
    cc3.getChainId(),
    cc3.getBlockNumber(),
    eth.getChainId(),
  ]);
  if (cc3ChainId !== CC3_CHAIN_ID)
    throw new Error(`CC3 chain ID mismatch: ${cc3ChainId}`);
  if (ethereumChainId !== SOURCE_CHAIN_ID)
    throw new Error(`Ethereum chain ID mismatch: ${ethereumChainId}`);

  const [
    aggregator,
    decimals,
    description,
    receipt,
    aggregatorCode,
    blockProverCode,
    chainInfoCode,
    decoderCode,
  ] = await Promise.all([
    eth.readContract({
      address: PROXY,
      abi: FEED_ABI,
      functionName: "aggregator",
    }),
    eth.readContract({
      address: PROXY,
      abi: FEED_ABI,
      functionName: "decimals",
    }),
    eth.readContract({
      address: PROXY,
      abi: FEED_ABI,
      functionName: "description",
    }),
    eth.getTransactionReceipt({ hash: FIXTURE_TX }),
    eth.getBytecode({ address: PROXY }),
    rpcCode(cc3, BLOCK_PROVER),
    rpcCode(cc3, CHAIN_INFO),
    cc3.getBytecode({ address: DECODER }),
  ]);

  const topic0 = keccak256(
    "0x416e737765725570646174656428696e743235362c75696e743235362c75696e7432353629" as Hex,
  );
  const receiptLogPosition = receipt.logs.findIndex(
    (log) =>
      lower(log.address) === lower(aggregator) &&
      lower(log.topics[0] ?? "") === lower(topic0),
  );
  if (receiptLogPosition < 0)
    throw new Error("fixture AnswerUpdated log was not found in receipt");
  const sourceLog = receipt.logs[receiptLogPosition];
  if (!sourceLog || !sourceLog.topics[1] || !sourceLog.topics[2])
    throw new Error("fixture log is malformed");
  const answer = hexToSigned(sourceLog.topics[1]);
  const roundId = BigInt(sourceLog.topics[2]);
  const updatedAt = BigInt(sourceLog.data);
  const expected = {
    transactionHash: FIXTURE_TX,
    blockNumber: receipt.blockNumber,
    transactionIndex: receipt.transactionIndex,
    rpcBlockLogIndex: sourceLog.logIndex,
    receiptLogPosition,
    emitter: sourceLog.address,
    topic0: sourceLog.topics[0],
    topics: sourceLog.topics,
    data: sourceLog.data,
    answer,
    roundId,
    updatedAt,
    receiptStatus: receipt.status,
  };
  if (
    answer !== 99_989_777n ||
    roundId !== 1166n ||
    updatedAt !== 1_788_249_611n
  ) {
    throw new Error(
      `fixture decoded values changed: ${JSON.stringify(jsonValue(expected))}`,
    );
  }
  if (receipt.status !== "success")
    throw new Error(`fixture receipt status is ${receipt.status}`);

  const proofStarted = Date.now();
  const proofBuilder = new proofProvider.service.ProofBuilder(
    CHAIN_KEY,
    proofUrl,
    30_000,
  );
  const proofResult = await proofBuilder.getProof(FIXTURE_TX);
  if (!proofResult.success || !proofResult.data)
    throw new Error(proofResult.error ?? "proof generation failed");
  const proof = proofResult.data;
  const proofGenerationMs = Date.now() - proofStarted;
  const rawProof = jsonValue(proof);
  const rawProofCanonical = canonicalize(rawProof);
  const proofUrlHealth = `${proofUrl.replace(/\/$/, "")}/api/v1/attested-height/${CHAIN_KEY}`;
  const healthResponse = await fetch(proofUrlHealth);
  if (!healthResponse.ok)
    throw new Error(`proof service health failed: ${healthResponse.status}`);
  const health = (await healthResponse.json()) as { attestedHeight?: number };
  if (typeof health.attestedHeight !== "number")
    throw new Error("proof service health has no attestedHeight");

  const merkleProof = {
    root: proof.merkleProof.root as Hex,
    siblings: proof.merkleProof.siblings.map((sibling) => ({
      hash: sibling.hash as Hex,
      isLeft: sibling.isLeft,
    })),
  };
  const continuityProof = {
    lowerEndpointDigest: proof.continuityProof.lowerEndpointDigest as Hex,
    roots: proof.continuityProof.roots.map((root) => root as Hex),
  };
  const verified = await cc3.readContract({
    address: BLOCK_PROVER,
    abi: BLOCK_PROVER_ABI,
    functionName: "verify",
    args: [
      BigInt(proof.chainKey),
      BigInt(proof.headerNumber),
      proof.txBytes as Hex,
      merkleProof,
      continuityProof,
    ],
  });
  if (!verified) throw new Error("CC3 BlockProver returned false");

  const decoderType = await cc3.readContract({
    address: DECODER,
    abi: DECODER_ABI,
    functionName: "getTransactionType",
    args: [proof.txBytes as Hex],
  });

  const chainInfo = await cc3.readContract({
    address: CHAIN_INFO,
    abi: CHAIN_INFO_ABI,
    functionName: "get_chain_by_key",
    args: [BigInt(CHAIN_KEY)],
  });
  const latestAttestation = await cc3.readContract({
    address: CHAIN_INFO,
    abi: CHAIN_INFO_ABI,
    functionName: "get_latest_attestation_height_and_hash",
    args: [BigInt(CHAIN_KEY)],
  });

  const normalizedProof = {
    chainKey: proof.chainKey,
    headerNumber: proof.headerNumber,
    txIndex: proof.txIndex,
    txHash: proof.txHash,
    txBytes: proof.txBytes,
    continuityProof,
    merkleProof,
    cached: proof.cached,
    generatedAt:
      proof.generatedAt instanceof Date
        ? proof.generatedAt.toISOString()
        : new Date(String(proof.generatedAt)).toISOString(),
  };
  const proofCanonical = canonicalize(normalizedProof);
  const lock = {
    $schema: "./schemas/discovery-lock.schema.json",
    observedAt: now,
    gitCommit: discoveryGitCommit,
    networks: {
      cc3: {
        chainId: cc3ChainId,
        rpcUrl: cc3RpcUrl,
        latestBlock: Number(cc3LatestBlock),
        blockProver: {
          address: BLOCK_PROVER,
          codeHash: codeHash(blockProverCode),
        },
        chainInfo: { address: CHAIN_INFO, codeHash: codeHash(chainInfoCode) },
        decoder: {
          required: true,
          address: DECODER,
          codeHash: codeHash(decoderCode),
          fixtureTransactionType: Number(decoderType),
        },
      },
      ethereum: {
        chainId: ethereumChainId,
        attestcoinChainKey: CHAIN_KEY,
        usdcUsdProxy: PROXY,
        underlyingAggregator: aggregator,
        aggregatorCodeHash: codeHash(aggregatorCode),
        feedDecimals: Number(decimals),
        description,
        answerUpdatedTopic0: topic0,
        answerUpdatedAbi: {
          signature: "AnswerUpdated(int256,uint256,uint256)",
          topics: [
            "topic0",
            "indexed int256 current",
            "indexed uint256 roundId",
          ],
          data: "uint256 updatedAt",
        },
      },
    },
    attestcoin: {
      sdkPackage: "@gluwa/usc-sdk",
      sdkVersion: "0.18.0",
      proofServiceUrl: proofUrl,
      proofServiceHealth: {
        endpoint: proofUrlHealth,
        attestedHeight: health.attestedHeight,
      },
      sdkEntrypoint: "proofProvider.service.ProofBuilder",
      sdkProofMethod:
        "new ProofBuilder(chainKey, builderUrl, timeout).getProof(transactionHash)",
      proofTypeDeclaration: "dist/proof-provider/index.d.ts#ContinuityResponse",
      solidityVerifierInterface:
        "dist/block-prover/block_prover.json#verify(uint64,uint64,bytes,tuple,tuple)",
      receiptStatusRule:
        "encoded receipt receiptStatus === 1; source RPC receipt status === success",
      verificationReturnShape:
        "verify(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[])) returns (bool)",
    },
    fixture: {
      transactionHash: FIXTURE_TX,
      blockNumber: Number(receipt.blockNumber),
      rpcBlockLogIndex: Number(sourceLog.logIndex),
      receiptLogPosition,
      roundId: roundId.toString(),
      answer: answer.toString(),
      updatedAt: Number(updatedAt),
      proofSha256: sha256(proofCanonical),
      proofBytes: Buffer.byteLength(proofCanonical, "utf8"),
      txBytesLength: (proof.txBytes.length - 2) / 2,
      generationMs: proofGenerationMs,
      verificationGasEstimate: null,
      cc3VerificationTransaction: "eth_call:success",
    },
    toolchain: {
      node: process.version,
      pnpm: "11.22.0",
      forge: "1.7.1+4072e48705af9d93e3c0f6e29e93b5e9a40caed8",
      solc: "0.8.28",
      frontendLockfileSha256: null,
    },
    evidence: [
      {
        field: "networks.cc3.chainId",
        source: "rpc",
        reference: cc3RpcUrl,
        command: "cast chain-id --rpc-url $CC3_RPC_URL",
        observed: String(cc3ChainId),
        observedAt: now,
      },
      {
        field: "networks.cc3.latestBlock",
        source: "rpc",
        reference: cc3RpcUrl,
        command: "cast block-number --rpc-url $CC3_RPC_URL",
        observed: String(cc3LatestBlock),
        observedAt: now,
      },
      {
        field: "networks.ethereum.proxyAndAggregator",
        source: "rpc",
        reference: ethereumRpcUrl,
        command:
          "cast call $USDC_USD_PROXY_ADDRESS aggregator() --rpc-url $ETHEREUM_RPC_URL",
        observed: `${PROXY} -> ${aggregator}`,
        observedAt: now,
      },
      {
        field: "networks.ethereum.feedMetadata",
        source: "rpc",
        reference: ethereumRpcUrl,
        command:
          "cast call proxy decimals() and description() --rpc-url $ETHEREUM_RPC_URL",
        observed: `${decimals}; ${description}`,
        observedAt: now,
      },
      {
        field: "fixture.sourceLog",
        source: "live-transaction",
        reference: FIXTURE_TX,
        command:
          "cast receipt $SOURCE_TX_HASH --rpc-url $ETHEREUM_RPC_URL --json",
        observed: JSON.stringify(jsonValue(expected)),
        observedAt: now,
      },
      {
        field: "attestcoin.proofService",
        source: "official-doc",
        reference: proofUrlHealth,
        command: "GET /api/v1/attested-height/3",
        observed: JSON.stringify(health),
        observedAt: now,
      },
      {
        field: "attestcoin.sdkProof",
        source: "installed-package",
        reference: "node_modules/@gluwa/usc-sdk/dist/proof-provider",
        command:
          "new proofProvider.service.ProofBuilder(3, url, 30000).getProof(txHash)",
        observed: JSON.stringify({
          chainKey: proof.chainKey,
          headerNumber: proof.headerNumber,
          txIndex: proof.txIndex,
          txBytesLength: (proof.txBytes.length - 2) / 2,
          merkleSiblings: proof.merkleProof.siblings.length,
          continuityRoots: proof.continuityProof.roots.length,
          cached: proof.cached,
        }),
        observedAt: now,
      },
      {
        field: "networks.cc3.blockProver.verify",
        source: "live-transaction",
        reference: BLOCK_PROVER,
        command: "eth_call verify(uint64,uint64,bytes,tuple,tuple)",
        observed: "true",
        observedAt: now,
      },
      {
        field: "networks.cc3.decoder",
        source: "live-transaction",
        reference: DECODER,
        command: "eth_call getTransactionType(bytes)",
        observed: String(decoderType),
        observedAt: now,
      },
      {
        field: "networks.cc3.chainInfo",
        source: "live-transaction",
        reference: CHAIN_INFO,
        command: "eth_call get_chain_by_key(uint64)",
        observed: JSON.stringify(jsonValue(chainInfo)),
        observedAt: now,
      },
      {
        field: "networks.cc3.latestAttestation",
        source: "live-transaction",
        reference: CHAIN_INFO,
        command: "eth_call get_latest_attestation_height_and_hash(uint64)",
        observed: JSON.stringify(jsonValue(latestAttestation)),
        observedAt: now,
      },
    ],
  };

  const lockPath = resolve(repoRoot, "docs/discovery-lock.json");
  const evidencePath = resolve(repoRoot, "docs/evidence/P02-discovery.md");
  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  const evidence = `# P02 — Live integration discovery\n\nStatus: PASS for discovery and read-only fixture verification\nObserved at: ${now}\n\n## Verified values\n\n- CC3 chain ID: **${cc3ChainId}**; latest queried block: **${cc3LatestBlock}**.\n- Ethereum chain ID: **${ethereumChainId}**.\n- USDC/USD proxy: **${PROXY}**.\n- Underlying event emitter: **${aggregator}**; code hash: **${codeHash(aggregatorCode)}**.\n- Feed: **${description}**, decimals **${decimals}**.\n- \`AnswerUpdated\` topic0: **${topic0}**.\n- Fixture RPC block-global log index: **${sourceLog.logIndex}**; receipt log position: **${receiptLogPosition}**.\n- Fixture decoded answer/round/time: **${answer}/${roundId}/${updatedAt}**.\n- Decoder candidate **${DECODER}** accepts \`getTransactionType\` for the fixture and returns type **${decoderType}**.\n- BlockProver \`verify\` returns **true** for the real proof.\n- Proof service attested height for chain key 3: **${health.attestedHeight}**.\n\n## SDK facts\n\n- Entrypoint: \`proofProvider.service.ProofBuilder\`.\n- Constructor: \`new ProofBuilder(chainKey, builderUrl, timeout?)\`.\n- Proof method: \`getProof(transactionHash) -> Promise<ProofResult>\`.\n- Response fields: \`chainKey\`, \`headerNumber\`, \`txIndex\`, \`txHash\`, \`txBytes\`, \`merkleProof\`, \`continuityProof\`, \`cached\`, \`generatedAt\`.\n- BlockProver call: \`verify(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[])) returns (bool)\`.\n- Proof service route: \`/api/v1/proof-by-tx/{chainKey}/{transactionHash}\`.\n\n## Evidence\n\nFull machine-readable evidence is in \`docs/discovery-lock.json\`. The historical fixture is valid for decoder/proof testing only; it is not a policy claim event.\n\nNext allowed packet: **P03 — reproducible real-proof fixture**.\n`;
  await writeFile(evidencePath, evidence, "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        lockPath,
        evidencePath,
        fixture: jsonValue(expected),
        proofSha256: sha256(proofCanonical),
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exit(1);
});
