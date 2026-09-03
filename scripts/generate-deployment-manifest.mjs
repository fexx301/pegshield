import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const CC3_CHAIN_ID = 102031;
const ETHEREUM_CHAIN_ID = 1;
const DEFAULT_RPC = "https://rpc.cc3-testnet.creditcoin.network";
const DEFAULT_ETHEREUM_RPC = "https://ethereum-rpc.publicnode.com";
const SOURCE_AGGREGATOR = "0xc9e1a09622afdb659913fefe800feae5dbbfe9d7";
const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);
const { createPublicClient, http, keccak256, toBytes } = require(
  resolve(repoRoot, "worker/node_modules/viem/_cjs/index.js"),
);
const lock = JSON.parse(
  readFileSync(resolve(repoRoot, "docs/discovery-lock.json"), "utf8"),
);

const POOL_ABI = [
  {
    type: "function",
    name: "getProduct",
    stateMutability: "view",
    inputs: [{ name: "productId", type: "uint256" }],
    outputs: [
      {
        name: "product",
        type: "tuple",
        components: [
          { name: "chainKey", type: "uint256" },
          { name: "aggregator", type: "address" },
          { name: "feedDecimals", type: "uint8" },
          { name: "triggerBelow", type: "int256" },
          { name: "activationDelay", type: "uint64" },
          { name: "policyDuration", type: "uint64" },
          { name: "claimGracePeriod", type: "uint64" },
          { name: "minBreachDuration", type: "uint64" },
          { name: "premiumBps", type: "uint32" },
          { name: "maxCoveragePerPolicy", type: "uint256" },
          { name: "enabled", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getPolicy",
    stateMutability: "view",
    inputs: [{ name: "policyId", type: "uint256" }],
    outputs: [
      {
        name: "policy",
        type: "tuple",
        components: [
          { name: "productId", type: "uint256" },
          { name: "holder", type: "address" },
          { name: "beneficiary", type: "address" },
          { name: "coverage", type: "uint256" },
          { name: "premium", type: "uint256" },
          { name: "purchasedAt", type: "uint64" },
          { name: "startsAt", type: "uint64" },
          { name: "endsAt", type: "uint64" },
          { name: "firstBreachAt", type: "uint64" },
          { name: "firstRoundId", type: "uint256" },
          { name: "firstEventId", type: "bytes32" },
          { name: "state", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "hasRole",
    stateMutability: "view",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
];

function args(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value?.startsWith("--")) values[value.slice(2)] = argv[index + 1];
  }
  return values;
}

function required(values, name) {
  const value = values[name];
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function safeNumber(value, field) {
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue < 0) {
    throw new Error(`${field} is outside the safe integer range`);
  }
  return numberValue;
}

function decimal(value) {
  return BigInt(value).toString();
}

function hashOf(value, field, override) {
  const hash =
    override ??
    value?.hash ??
    value?.transactionHash ??
    value?.transaction?.hash;
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error(`${field} does not contain a transaction hash`);
  }
  return hash.toLowerCase();
}

async function receiptFor(transaction, receipts, client, overrideHash) {
  const field = transaction.contractName ?? "transaction";
  const hash = hashOf(transaction, field, overrideHash);
  let receipt = receipts.find((candidate) => {
    const candidateHash = candidate.transactionHash ?? candidate.hash;
    return (
      typeof candidateHash === "string" && candidateHash.toLowerCase() === hash
    );
  });
  if (!receipt) {
    try {
      receipt = await client.getTransactionReceipt({ hash });
    } catch {
      throw new Error(`missing receipt for ${field}`);
    }
  }
  const status = receipt.status;
  if (status !== undefined && status !== "0x1" && status !== "success") {
    throw new Error(`${field} transaction did not succeed`);
  }
  return { hash, receipt };
}

function findTransaction(transactions, name, predicate = () => true) {
  const transaction = transactions.find(
    (candidate) => candidate.contractName === name && predicate(candidate),
  );
  if (!transaction) throw new Error(`broadcast file is missing ${name}`);
  return transaction;
}

function publicRpcUrl(value) {
  const parsed = new URL(value);
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function codeHash(client, address) {
  return client.getBytecode({ address }).then((bytecode) => {
    if (!bytecode || bytecode === "0x")
      throw new Error(`no runtime code at ${address}`);
    return keccak256(bytecode).toLowerCase();
  });
}

async function dependencyRecord(client, dependency) {
  const bytecode = await client.getBytecode({ address: dependency.address });
  const codeHash =
    bytecode && bytecode !== "0x" ? keccak256(bytecode).toLowerCase() : null;
  if (
    dependency.codeHash &&
    codeHash?.toLowerCase() !== dependency.codeHash.toLowerCase()
  ) {
    throw new Error(`dependency code hash mismatch at ${dependency.address}`);
  }
  return {
    address: dependency.address,
    codeHash,
    precompile: codeHash === null,
  };
}

async function main() {
  const values = args(process.argv.slice(2));
  const broadcastPath = resolve(
    repoRoot,
    values.broadcast ??
      "contracts/broadcast/Deploy.s.sol/102031/run-latest.json",
  );
  const outPath = resolve(
    repoRoot,
    values.out ?? "deployments/cc3-testnet.json",
  );
  if (!existsSync(broadcastPath)) {
    throw new Error(`broadcast file not found: ${broadcastPath}`);
  }
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  if (dirty)
    throw new Error(
      "working tree must be clean before generating a deployment manifest",
    );

  const broadcast = JSON.parse(readFileSync(broadcastPath, "utf8"));
  const transactions = broadcast.transactions ?? [];
  const receipts = broadcast.receipts ?? [];
  const rpcUrl = process.env.CC3_RPC_URL ?? DEFAULT_RPC;
  const client = createPublicClient({
    chain: {
      id: CC3_CHAIN_ID,
      name: "Creditcoin CC3 testnet",
      nativeCurrency: { name: "Creditcoin", symbol: "CTC", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    transport: http(rpcUrl),
  });
  const tokenTx = findTransaction(transactions, "TestUSD", (candidate) =>
    Boolean(candidate.contractAddress),
  );
  const adapterTx = findTransaction(
    transactions,
    "AttestcoinVerifierAdapter",
    (candidate) => Boolean(candidate.contractAddress),
  );
  const poolTx = findTransaction(transactions, "PegShieldPool", (candidate) =>
    Boolean(candidate.contractAddress),
  );
  const productTx = findTransaction(
    transactions,
    "PegShieldPool",
    (candidate) =>
      String(
        candidate.function ?? candidate.contractFunctionName ?? "",
      ).includes("createProduct"),
  );
  const policyTx = findTransaction(transactions, "PegShieldPool", (candidate) =>
    String(candidate.function ?? candidate.contractFunctionName ?? "").includes(
      "buyPolicy",
    ),
  );
  const tokenReceipt = await receiptFor(tokenTx, receipts, client);
  const adapterReceipt = await receiptFor(adapterTx, receipts, client);
  const poolReceipt = await receiptFor(poolTx, receipts, client);
  const productReceipt = await receiptFor(
    productTx,
    receipts,
    client,
    values["product-tx-hash"],
  );
  const policyReceipt = await receiptFor(
    policyTx,
    receipts,
    client,
    values["policy-tx-hash"],
  );
  if ((await client.getChainId()) !== CC3_CHAIN_ID)
    throw new Error("CC3 chain ID mismatch");
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
  if ((await ethereumClient.getChainId()) !== ETHEREUM_CHAIN_ID)
    throw new Error("Ethereum RPC chain ID mismatch");

  const dependencies = {
    blockProver: await dependencyRecord(client, lock.networks.cc3.blockProver),
    chainInfo: await dependencyRecord(client, lock.networks.cc3.chainInfo),
    decoder: await dependencyRecord(client, lock.networks.cc3.decoder),
    sourceAggregator: await dependencyRecord(ethereumClient, {
      address: lock.networks.ethereum.underlyingAggregator,
      codeHash: lock.networks.ethereum.aggregatorCodeHash,
    }),
  };

  const poolAddress = poolTx.contractAddress;
  const product = await client.readContract({
    address: poolAddress,
    abi: POOL_ABI,
    functionName: "getProduct",
    args: [1n],
  });
  const policy = await client.readContract({
    address: poolAddress,
    abi: POOL_ABI,
    functionName: "getPolicy",
    args: [1n],
  });
  const underwriter = process.env.UNDERWRITER_ADDRESS;
  const deployer = process.env.DEPLOYER_ADDRESS;
  const treasury = process.env.TREASURY_ADDRESS;
  const policyholder = process.env.POLICYHOLDER_ADDRESS;
  if (!underwriter || !deployer || !treasury || !policyholder) {
    throw new Error(
      "deployment account addresses must be provided in the environment",
    );
  }
  const underwriterRole = keccak256(toBytes("UNDERWRITER_ROLE"));
  const adminRole = `0x${"00".repeat(32)}`;
  const [underwriterAuthorized, adminAuthorized] = await Promise.all([
    client.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: "hasRole",
      args: [underwriterRole, underwriter],
    }),
    client.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: "hasRole",
      args: [adminRole, underwriter],
    }),
  ]);
  if (!underwriterAuthorized || !adminAuthorized) {
    throw new Error("underwriter role assertions failed");
  }
  if (policy.holder.toLowerCase() !== policyholder.toLowerCase()) {
    throw new Error("demo policy holder does not match POLICYHOLDER_ADDRESS");
  }
  if (product.aggregator.toLowerCase() !== SOURCE_AGGREGATOR) {
    throw new Error(
      "deployed product aggregator differs from the discovery lock",
    );
  }
  if (
    decimal(product.chainKey) !== "3" ||
    !product.enabled ||
    BigInt(product.activationDelay) === 0n ||
    BigInt(product.claimGracePeriod) === 0n ||
    BigInt(product.minBreachDuration) === 0n ||
    BigInt(product.minBreachDuration) >= BigInt(product.policyDuration)
  ) {
    throw new Error("deployed product terms fail PegShield validation");
  }
  if (
    BigInt(policy.productId) !== 1n ||
    policy.beneficiary === "0x0000000000000000000000000000000000000000"
  ) {
    throw new Error("demo policy terms are invalid");
  }

  const firstBlock = Math.min(
    safeNumber(tokenReceipt.receipt.blockNumber, "token block"),
    safeNumber(adapterReceipt.receipt.blockNumber, "adapter block"),
    safeNumber(poolReceipt.receipt.blockNumber, "pool block"),
  );
  const deploymentBlock = await client.getBlock({
    blockNumber: BigInt(firstBlock),
  });
  const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const manifest = {
    $schema: "../docs/schemas/deployment.schema.json",
    schemaVersion: 1,
    network: {
      name: "creditcoin-cc3-testnet",
      chainId: CC3_CHAIN_ID,
      rpcUrl: publicRpcUrl(rpcUrl),
    },
    source: {
      gitCommit,
      solc: "0.8.28",
      optimizerRuns: 200,
      evmVersion: "london",
    },
    accounts: { deployer, underwriter, treasury, policyholder },
    roles: { defaultAdmin: underwriter, underwriter },
    dependencies,
    contracts: {
      testUSD: {
        address: tokenTx.contractAddress,
        txHash: tokenReceipt.hash,
        blockNumber: safeNumber(
          tokenReceipt.receipt.blockNumber,
          "token block",
        ),
        codeHash: await codeHash(client, tokenTx.contractAddress),
      },
      adapter: {
        address: adapterTx.contractAddress,
        txHash: adapterReceipt.hash,
        blockNumber: safeNumber(
          adapterReceipt.receipt.blockNumber,
          "adapter block",
        ),
        codeHash: await codeHash(client, adapterTx.contractAddress),
      },
      pool: {
        address: poolAddress,
        txHash: poolReceipt.hash,
        blockNumber: safeNumber(poolReceipt.receipt.blockNumber, "pool block"),
        codeHash: await codeHash(client, poolAddress),
      },
    },
    product: {
      id: "1",
      creationTxHash: productReceipt.hash,
      chainKey: decimal(product.chainKey),
      aggregator: product.aggregator,
      feedDecimals: safeNumber(product.feedDecimals, "feedDecimals"),
      triggerBelow: decimal(product.triggerBelow),
      activationDelay: safeNumber(product.activationDelay, "activationDelay"),
      policyDuration: safeNumber(product.policyDuration, "policyDuration"),
      claimGracePeriod: safeNumber(
        product.claimGracePeriod,
        "claimGracePeriod",
      ),
      minBreachDuration: safeNumber(
        product.minBreachDuration,
        "minBreachDuration",
      ),
      premiumBps: safeNumber(product.premiumBps, "premiumBps"),
      maxCoveragePerPolicy: decimal(product.maxCoveragePerPolicy),
      demoOnly: true,
    },
    demoPolicy: {
      id: "1",
      purchaseTxHash: policyReceipt.hash,
      purchaseBlockNumber: safeNumber(
        policyReceipt.receipt.blockNumber,
        "policy block",
      ),
      holder: policy.holder,
      beneficiary: policy.beneficiary,
      coverage: decimal(policy.coverage),
      premium: decimal(policy.premium),
      purchasedAt: safeNumber(policy.purchasedAt, "purchasedAt"),
      startsAt: safeNumber(policy.startsAt, "startsAt"),
      endsAt: safeNumber(policy.endsAt, "endsAt"),
      state: safeNumber(policy.state, "policy.state"),
    },
    deployedAt: new Date(
      Number(deploymentBlock.timestamp) * 1_000,
    ).toISOString(),
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify({ ok: true, out: outPath, pool: poolAddress }, null, 2),
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "manifest generation failed",
  );
  process.exitCode = 1;
});
