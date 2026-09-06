"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import { ClaimProgress } from "./ClaimProgress";
import { CompletedPayout } from "./CompletedPayout";
import {
  encodeFunctionData,
  formatUnits,
  isAddress,
  parseUnits,
  type Address,
} from "viem";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useEstimateGas,
  useReadContract,
  useReadContracts,
  useSimulateContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { injected } from "wagmi/connectors";
import {
  CC3_TESTNET,
  CLAIM_WRITE_ABI,
  ERC20_READ_ABI,
  ERC20_WRITE_ABI,
  PEGSHIELD_POOL_ADDRESS,
  POOL_READ_ABI,
  POOL_WRITE_ABI,
} from "../lib/chain";
import {
  type ProofArtifact,
  encodeProof,
  proofDigest,
  validateProofArtifact,
} from "../lib/proof";

const SOURCE_EXPLORER = "https://etherscan.io/tx";
const SOURCE_TX =
  "0x60f65e8b0b14daf28495f367ed8f46ade4ebabec4e4b13c86a3f55a7b2f34245";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

type ProductRead = {
  chainKey: bigint;
  aggregator: Address;
  feedDecimals: number;
  triggerBelow: bigint;
  activationDelay: bigint;
  policyDuration: bigint;
  claimGracePeriod: bigint;
  minBreachDuration: bigint;
  premiumBps: number;
  maxCoveragePerPolicy: bigint;
  enabled: boolean;
};

type PolicyRead = {
  productId: bigint;
  holder: Address;
  beneficiary: Address;
  coverage: bigint;
  premium: bigint;
  purchasedAt: bigint;
  startsAt: bigint;
  endsAt: bigint;
  firstBreachAt: bigint;
  firstRoundId: bigint;
  firstEventId: `0x${string}`;
  state: number;
};

function formatUsd(value: number) {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function formatTokenUnits(value: bigint) {
  if (value < 0n) return "N/A";
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `$${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

function formatFeedUnits(value: bigint | undefined) {
  if (value === undefined) return "not deployed";
  return `$${formatUnits(value, 8)}`;
}

function formatDuration(value: bigint | undefined) {
  if (value === undefined) return "not deployed";
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds)) return "N/A";
  if (seconds % 86_400 === 0) return `${seconds / 86_400} days`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} hours`;
  if (seconds % 60 === 0) return `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "The wallet or CC3 transaction was rejected. Nothing was submitted.";
}

export function PegShieldDashboard() {
  const [coverage, setCoverage] = useState("100");
  const [beneficiary, setBeneficiary] = useState("");
  const [requestedPolicyId, setRequestedPolicyId] = useState<bigint>();
  const [purchaseStatus, setPurchaseStatus] = useState<
    | "idle"
    | "approving"
    | "approval-confirmed"
    | "purchasing"
    | "confirmed"
    | "error"
  >("idle");
  const [purchaseError, setPurchaseError] = useState<string>();
  const [firstClaimArtifact, setFirstClaimArtifact] = useState<ProofArtifact>();
  const [firstClaimArtifactName, setFirstClaimArtifactName] =
    useState<string>();
  const [firstClaimArtifactError, setFirstClaimArtifactError] =
    useState<string>();
  const [confirmationClaimArtifact, setConfirmationClaimArtifact] =
    useState<ProofArtifact>();
  const [confirmationClaimArtifactName, setConfirmationClaimArtifactName] =
    useState<string>();
  const [confirmationClaimArtifactError, setConfirmationClaimArtifactError] =
    useState<string>();
  const [claimStatus, setClaimStatus] = useState<
    "idle" | "validating" | "simulating" | "submitting" | "confirmed" | "error"
  >("idle");
  const [claimError, setClaimError] = useState<string>();
  const [proofPreparedAt, setProofPreparedAt] = useState<number>();
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const poolAddress = PEGSHIELD_POOL_ADDRESS ?? ZERO_ADDRESS;
  const {
    data: poolReads,
    isPending: poolReadsPending,
    isError: poolReadsError,
    refetch: refetchPoolReads,
  } = useReadContracts({
    contracts: PEGSHIELD_POOL_ADDRESS
      ? [
          {
            address: poolAddress,
            abi: POOL_READ_ABI,
            functionName: "accountedCapital",
          },
          {
            address: poolAddress,
            abi: POOL_READ_ABI,
            functionName: "reservedCapital",
          },
          {
            address: poolAddress,
            abi: POOL_READ_ABI,
            functionName: "nextPolicyId",
          },
        ]
      : [],
    query: {
      enabled: Boolean(PEGSHIELD_POOL_ADDRESS),
    },
  });
  const readResult = (index: number): unknown => {
    const item = poolReads?.[index] as
      | { status?: string; result?: unknown }
      | undefined;
    return item?.status === "success" ? item.result : undefined;
  };
  const metricsReadError = Boolean(
    poolReads?.some(
      (item) => (item as { status?: string }).status === "failure",
    ),
  );
  const liveAccountedCapital = readResult(0) as bigint | undefined;
  const liveReservedCapital = readResult(1) as bigint | undefined;
  const livePolicyCount = readResult(2) as bigint | undefined;
  const { data: payoutTokenData } = useReadContract({
    address: poolAddress,
    abi: POOL_READ_ABI,
    functionName: "payoutToken",
    chainId: CC3_TESTNET.id,
    query: { enabled: Boolean(PEGSHIELD_POOL_ADDRESS) },
  });
  const payoutTokenAddress = payoutTokenData as Address | undefined;
  const {
    data: tokenReads,
    isPending: tokenReadsPending,
    refetch: refetchTokenReads,
  } = useReadContracts({
    contracts:
      payoutTokenAddress && address
        ? [
            {
              address: payoutTokenAddress,
              abi: ERC20_READ_ABI,
              functionName: "balanceOf",
              args: [address],
            },
            {
              address: payoutTokenAddress,
              abi: ERC20_READ_ABI,
              functionName: "allowance",
              args: [address, poolAddress],
            },
          ]
        : [],
    query: {
      enabled: Boolean(
        payoutTokenAddress &&
          address &&
          isConnected &&
          chainId === CC3_TESTNET.id,
      ),
    },
  });
  const tokenReadResult = (index: number): unknown => {
    const item = tokenReads?.[index] as
      | { status?: string; result?: unknown }
      | undefined;
    return item?.status === "success" ? item.result : undefined;
  };
  const walletTokenBalance = tokenReadResult(0) as bigint | undefined;
  const walletTokenAllowance = tokenReadResult(1) as bigint | undefined;
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("policy");
    if (value && /^\d+$/.test(value)) {
      setRequestedPolicyId(BigInt(value));
    }
  }, []);
  const latestPolicyId =
    livePolicyCount !== undefined && livePolicyCount > 1n
      ? livePolicyCount - 1n
      : undefined;
  const selectedPolicyId =
    requestedPolicyId !== undefined &&
    livePolicyCount !== undefined &&
    requestedPolicyId > 0n &&
    requestedPolicyId < livePolicyCount
      ? requestedPolicyId
      : (latestPolicyId ?? 1n);
  const {
    data: productData,
    isPending: productPending,
    isError: productError,
  } = useReadContract({
    address: poolAddress,
    abi: POOL_READ_ABI,
    functionName: "getProduct",
    args: [1n],
    chainId: CC3_TESTNET.id,
    query: { enabled: Boolean(PEGSHIELD_POOL_ADDRESS) },
  });
  const liveProduct = productData as ProductRead | undefined;
  const validCoverage = /^\d+(\.\d{0,6})?$/.test(coverage);
  let coverageUnits: bigint | undefined;
  try {
    coverageUnits = validCoverage ? parseUnits(coverage || "0", 6) : undefined;
  } catch {
    coverageUnits = undefined;
  }
  const beneficiaryIsValid = isAddress(beneficiary);
  const beneficiaryAddress = beneficiaryIsValid
    ? (beneficiary as Address)
    : ZERO_ADDRESS;
  const {
    data: quotedPremium,
    isError: quotedPremiumError,
    refetch: refetchQuotedPremium,
  } = useReadContract({
    address: poolAddress,
    abi: POOL_READ_ABI,
    functionName: "quotePremium",
    args: [1n, coverageUnits ?? 0n],
    chainId: CC3_TESTNET.id,
    query: {
      enabled: Boolean(
        PEGSHIELD_POOL_ADDRESS &&
          coverageUnits !== undefined &&
          coverageUnits > 0n,
      ),
    },
  });
  const {
    data: policyData,
    isError: policyError,
    refetch: refetchPolicy,
  } = useReadContract({
    address: poolAddress,
    abi: POOL_READ_ABI,
    functionName: "getPolicy",
    args: [selectedPolicyId],
    chainId: CC3_TESTNET.id,
    query: {
      enabled: Boolean(
        PEGSHIELD_POOL_ADDRESS &&
          livePolicyCount &&
          selectedPolicyId > 0n &&
          selectedPolicyId < livePolicyCount,
      ),
    },
  });
  const livePolicy = policyData as PolicyRead | undefined;
  const connected = isConnected && chainId === CC3_TESTNET.id;
  const wrongNetwork = isConnected && chainId !== CC3_TESTNET.id;
  const poolPending = !PEGSHIELD_POOL_ADDRESS;
  const coverageAboveMaximum = Boolean(
    coverageUnits !== undefined &&
      liveProduct?.maxCoveragePerPolicy !== undefined &&
      coverageUnits > liveProduct.maxCoveragePerPolicy,
  );
  const purchasePrerequisites = Boolean(
    PEGSHIELD_POOL_ADDRESS &&
      connected &&
      address &&
      coverageUnits !== undefined &&
      coverageUnits > 0n &&
      !coverageAboveMaximum &&
      beneficiaryIsValid &&
      liveProduct?.enabled &&
      payoutTokenAddress &&
      quotedPremium !== undefined &&
      walletTokenBalance !== undefined &&
      walletTokenBalance >= quotedPremium,
  );
  const simulationEnabled = Boolean(
    purchasePrerequisites &&
      quotedPremium !== undefined &&
      walletTokenAllowance !== undefined &&
      walletTokenAllowance >= quotedPremium,
  );
  const poolReadUnavailable = Boolean(
    PEGSHIELD_POOL_ADDRESS &&
      (poolReadsError || metricsReadError || productError),
  );
  const poolState = poolPending
    ? "pending"
    : poolReadUnavailable
      ? "error"
      : poolReadsPending || productPending
        ? "reading"
        : "healthy";
  const numericCoverage = Number(coverage) || 0;
  const illustrativePremium = Math.ceil(numericCoverage * 0.025 * 100) / 100;
  const {
    data: purchaseSimulation,
    isPending: simulationPending,
    isError: simulationError,
  } = useSimulateContract({
    address: poolAddress,
    abi: POOL_WRITE_ABI,
    functionName: "buyPolicy",
    args: [1n, coverageUnits ?? 0n, beneficiaryAddress],
    account: address,
    chainId: CC3_TESTNET.id,
    query: {
      enabled: simulationEnabled,
    },
  });
  const effectiveSimulationPending = simulationEnabled && simulationPending;
  const approvalWriter = useWriteContract();
  const purchaseWriter = useWriteContract();
  const claimWriter = useWriteContract();
  const approvalReceipt = useWaitForTransactionReceipt({
    hash: approvalWriter.data,
    chainId: CC3_TESTNET.id,
    query: { enabled: Boolean(approvalWriter.data) },
  });
  const purchaseReceipt = useWaitForTransactionReceipt({
    hash: purchaseWriter.data,
    chainId: CC3_TESTNET.id,
    query: { enabled: Boolean(purchaseWriter.data) },
  });
  const claimReceipt = useWaitForTransactionReceipt({
    hash: claimWriter.data,
    chainId: CC3_TESTNET.id,
    query: { enabled: Boolean(claimWriter.data) },
  });
  const hasLivePolicy = Boolean(livePolicy && livePolicy.productId > 0n);
  const nowSeconds = BigInt(Math.floor(clock / 1_000));
  const activationComplete = Boolean(
    hasLivePolicy && livePolicy && nowSeconds >= livePolicy.startsAt,
  );
  const terminalPolicy = livePolicy?.state === 2 || livePolicy?.state === 3;
  const proofTooOld =
    proofPreparedAt !== undefined && clock - proofPreparedAt > 90000;
  const acceptPrepared = useCallback(
    (artifacts?: [ProofArtifact, ProofArtifact]) => {
      setFirstClaimArtifact(artifacts?.[0]);
      setConfirmationClaimArtifact(artifacts?.[1]);
      setFirstClaimArtifactName(
        artifacts ? "Automatically prepared" : undefined,
      );
      setConfirmationClaimArtifactName(
        artifacts ? "Automatically prepared" : undefined,
      );
      setFirstClaimArtifactError(undefined);
      setConfirmationClaimArtifactError(undefined);
      setProofPreparedAt(artifacts ? Date.now() : undefined);
      setClaimError(undefined);
      setClaimStatus("idle");
    },
    [],
  );
  useEffect(() => {
    acceptPrepared();
  }, [selectedPolicyId, acceptPrepared]);
  const policyStateLabel = hasLivePolicy
    ? (["Active", "Breach observed", "Claimed", "Expired"][
        livePolicy?.state ?? 0
      ] ?? "Unknown")
    : "Not loaded";

  const encodedFirstClaimProof = firstClaimArtifact
    ? encodeProof(firstClaimArtifact)
    : undefined;
  const firstClaimReceiptLogPosition = firstClaimArtifact
    ? BigInt(firstClaimArtifact.source.receiptLogPosition)
    : 0n;
  const encodedConfirmationClaimProof = confirmationClaimArtifact
    ? encodeProof(confirmationClaimArtifact)
    : undefined;
  const confirmationClaimReceiptLogPosition = confirmationClaimArtifact
    ? BigInt(confirmationClaimArtifact.source.receiptLogPosition)
    : 0n;
  const claimData =
    encodedFirstClaimProof && encodedConfirmationClaimProof
      ? encodeFunctionData({
          abi: CLAIM_WRITE_ABI,
          functionName: "submitClaim",
          args: [
            selectedPolicyId,
            encodedFirstClaimProof,
            firstClaimReceiptLogPosition,
            encodedConfirmationClaimProof,
            confirmationClaimReceiptLogPosition,
          ],
        })
      : undefined;
  const claimSimulationEnabled = Boolean(
    PEGSHIELD_POOL_ADDRESS &&
      connected &&
      !terminalPolicy &&
      !proofTooOld &&
      address &&
      hasLivePolicy &&
      firstClaimArtifact &&
      confirmationClaimArtifact &&
      encodedFirstClaimProof &&
      encodedConfirmationClaimProof,
  );
  const {
    data: claimSimulation,
    isPending: claimSimulationPending,
    isError: claimSimulationError,
    error: claimSimulationErrorValue,
    refetch: recheckClaimSimulation,
  } = useSimulateContract({
    address: poolAddress,
    abi: CLAIM_WRITE_ABI,
    functionName: "submitClaim",
    args: [
      selectedPolicyId,
      encodedFirstClaimProof ?? "0x",
      firstClaimReceiptLogPosition,
      encodedConfirmationClaimProof ?? "0x",
      confirmationClaimReceiptLogPosition,
    ],
    account: address,
    chainId: CC3_TESTNET.id,
    query: { enabled: claimSimulationEnabled },
  });
  const { data: claimGasEstimate, isError: claimGasError } = useEstimateGas({
    to: poolAddress,
    data: claimData,
    account: address,
    chainId: CC3_TESTNET.id,
    query: {
      enabled: Boolean(
        claimSimulationEnabled && claimData && !claimSimulationError,
      ),
    },
  });
  const claimGasLimit = claimGasEstimate
    ? (claimGasEstimate * 12_000n + 9_999n) / 10_000n
    : undefined;

  useEffect(() => {
    if (approvalReceipt.isSuccess) {
      setPurchaseStatus("approval-confirmed");
      setPurchaseError(undefined);
      void refetchTokenReads();
    } else if (approvalReceipt.isError || approvalWriter.error) {
      setPurchaseStatus("error");
      setPurchaseError(
        describeError(approvalWriter.error ?? approvalReceipt.error),
      );
    }
  }, [
    approvalReceipt.isError,
    approvalReceipt.isSuccess,
    approvalReceipt.error,
    approvalWriter.error,
    refetchTokenReads,
  ]);

  useEffect(() => {
    if (purchaseReceipt.isSuccess) {
      setPurchaseStatus("confirmed");
      setPurchaseError(undefined);
      void Promise.all([
        refetchPoolReads(),
        refetchTokenReads(),
        refetchQuotedPremium(),
      ]);
    } else if (purchaseReceipt.isError || purchaseWriter.error) {
      setPurchaseStatus("error");
      setPurchaseError(
        describeError(purchaseWriter.error ?? purchaseReceipt.error),
      );
    }
  }, [
    purchaseReceipt.data,
    purchaseReceipt.isError,
    purchaseReceipt.isSuccess,
    purchaseReceipt.error,
    purchaseWriter.error,
    refetchPoolReads,
    refetchQuotedPremium,
    refetchTokenReads,
  ]);

  useEffect(() => {
    if (purchaseReceipt.isSuccess) {
      const refreshed = purchaseReceipt.data;
      if (refreshed) {
        void refetchPoolReads().then((result) => {
          const nextPolicy = result.data?.[2]?.result as bigint | undefined;
          if (nextPolicy === undefined || nextPolicy <= 1n) return;
          const newPolicyId = nextPolicy - 1n;
          setRequestedPolicyId(newPolicyId);
          const url = new URL(window.location.href);
          url.searchParams.set("policy", newPolicyId.toString());
          window.history.replaceState({}, "", url);
        });
      }
    }
  }, [purchaseReceipt.data, purchaseReceipt.isSuccess, refetchPoolReads]);

  useEffect(() => {
    if (claimReceipt.isSuccess) {
      setClaimStatus("confirmed");
      setClaimError(undefined);
      void Promise.all([refetchPoolReads(), refetchPolicy()]);
    } else if (claimReceipt.isError || claimWriter.error) {
      setClaimStatus("error");
      setClaimError(describeError(claimWriter.error ?? claimReceipt.error));
    }
  }, [
    claimReceipt.isError,
    claimReceipt.isSuccess,
    claimReceipt.error,
    claimWriter.error,
    refetchPoolReads,
    refetchPolicy,
  ]);

  function previewPurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPurchaseError(undefined);
    if (!purchasePrerequisites || !quotedPremium || !payoutTokenAddress) {
      setPurchaseStatus("error");
      setPurchaseError(
        "Wallet balance, product terms, and CC3 reads are required.",
      );
      return;
    }
    try {
      if (
        walletTokenAllowance === undefined ||
        walletTokenAllowance < quotedPremium
      ) {
        setPurchaseStatus("approving");
        approvalWriter.writeContract({
          address: payoutTokenAddress,
          abi: ERC20_WRITE_ABI,
          functionName: "approve",
          args: [poolAddress, quotedPremium],
          account: address,
          chainId: CC3_TESTNET.id,
        });
        return;
      }
      if (!purchaseSimulation?.request) {
        setPurchaseStatus("error");
        setPurchaseError("CC3 purchase simulation has not passed yet.");
        return;
      }
      setPurchaseStatus("purchasing");
      purchaseWriter.writeContract({
        ...purchaseSimulation.request,
        account: address,
        chainId: CC3_TESTNET.id,
      });
    } catch (error) {
      setPurchaseStatus("error");
      setPurchaseError(describeError(error));
    }
  }

  async function handleProofFile(
    stage: "first" | "confirmation",
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    const setArtifact =
      stage === "first" ? setFirstClaimArtifact : setConfirmationClaimArtifact;
    const setArtifactName =
      stage === "first"
        ? setFirstClaimArtifactName
        : setConfirmationClaimArtifactName;
    const setArtifactError =
      stage === "first"
        ? setFirstClaimArtifactError
        : setConfirmationClaimArtifactError;
    setArtifact(undefined);
    setArtifactName(undefined);
    setArtifactError(undefined);
    setClaimError(undefined);
    setClaimStatus("idle");
    if (!file) return;
    if (file.size > 256 * 1024) {
      setArtifactError(
        "Proof artifact is larger than the 256 KiB safety limit.",
      );
      return;
    }
    setArtifactName(file.name);
    setClaimStatus("validating");
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const verified = await validateProofArtifact(parsed);
      setArtifact(verified.artifact);
      setProofPreparedAt(Date.now());
      setClaimStatus("idle");
    } catch (error) {
      setClaimStatus("error");
      setArtifactError(describeError(error));
    }
  }

  async function submitClaimProof() {
    setClaimError(undefined);
    if (
      !connected ||
      terminalPolicy ||
      proofTooOld ||
      !claimSimulation?.request ||
      !claimGasLimit
    ) {
      setClaimStatus("error");
      setClaimError(
        claimGasError
          ? "CC3 gas estimation failed; no claim was submitted."
          : "Proof simulation has not passed yet.",
      );
      return;
    }
    try {
      setClaimStatus("submitting");
      const fresh = await recheckClaimSimulation();
      if (fresh.error || !fresh.data?.request)
        throw new Error(
          "Your evidence no longer passes verification. Refresh claim evidence and try again.",
        );
      claimWriter.writeContract({
        ...fresh.data.request,
        gas: claimGasLimit,
        account: address,
        chainId: CC3_TESTNET.id,
      });
    } catch (error) {
      setClaimStatus("error");
      setClaimError(describeError(error));
    }
  }

  return (
    <main id="main-content" tabIndex={-1}>
      <a className="skip-link" href="#overview">
        Skip to main content
      </a>
      <div className="site-shell">
        <header className="topbar">
          <a
            className="wordmark"
            href="#overview"
            aria-label="PegShield overview"
          >
            <img
              className="wordmark-mark"
              src="/pegshield-mark.svg"
              alt=""
              aria-hidden="true"
              width={30}
              height={30}
            />
            <span>PegShield</span>
          </a>
          <nav className="nav-links" aria-label="Primary navigation">
            <a href="#pool">Pool</a>
            <a href="#product">Product</a>
            <a href="#policy">Policy</a>
            <a href="#evidence">Evidence</a>
            <a href="#trust">Trust model</a>
          </nav>
          <div className="topbar-actions">
            <span className="network-pill">CC3 · 102031</span>
            <span className="status-pill">TESTNET</span>
            <button
              className="button secondary"
              type="button"
              title={connected ? address : undefined}
              aria-label={connected ? `Connected wallet ${address}` : undefined}
              onClick={() => {
                if (wrongNetwork) switchChain({ chainId: CC3_TESTNET.id });
                else if (isConnected) disconnect();
                else connect({ connector: connectors[0] ?? injected() });
              }}
            >
              {wrongNetwork
                ? "Switch to CC3"
                : connected
                  ? `${address?.slice(0, 6)}…${address?.slice(-4)}`
                  : "Connect wallet"}
            </button>
          </div>
        </header>

        <section className="hero" id="overview">
          <div>
            <div className="eyebrow">Parametric protection / CC3 testnet</div>
            <h1>
              When the peg breaks, <em>proof pays.</em>
            </h1>
            <p className="hero-copy">
              Buy fixed protection for USDC. When two price observations meet
              your policy’s conditions, verified evidence unlocks your payout on
              Creditcoin.
            </p>
            <div className="hero-actions">
              <a className="button" href="#product">
                Buy test coverage
              </a>
              <a className="button ghost" href="#completed-payout">
                Explore a completed payout
              </a>
            </div>
            <p className="hero-note">
              No bridge. Reserves visible. Source chronology stays on-chain.
            </p>
          </div>
          <aside className="proof-console" aria-label="Proof pipeline status">
            <div className="console-top">
              <span className="console-title">
                Attestcoin verification rail
              </span>
              <span className="mono-label">
                {poolState === "healthy"
                  ? "CC3 read"
                  : poolState === "reading"
                    ? "Reading"
                    : poolState === "error"
                      ? "Read error"
                      : "Fixture view"}
              </span>
            </div>
            <p className="attestcoin-callout">
              <strong>Why Attestcoin?</strong> Attestcoin is the trust boundary:
              CC3 verifies Ethereum evidence without trusting PegShield&apos;s
              server.
            </p>
            <div className="console-body">
              <div
                className="console-state"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                <span className="state-mark">
                  {poolState === "healthy"
                    ? "✓"
                    : poolState === "error"
                      ? "!"
                      : "·"}
                </span>
                {poolState === "healthy"
                  ? "CC3 pool read verified"
                  : poolState === "reading"
                    ? "Reading configured CC3 pool"
                    : poolState === "error"
                      ? "CC3 pool read unavailable"
                      : "Historical source fixture available"}
              </div>
              <div className="console-big">1 → 3</div>
              <p className="console-sub">Ethereum event · CC3 settlement</p>
              <div className="console-grid">
                <div className="console-cell">
                  <span className="mono-label">Source feed</span>
                  <strong>USDC / USD</strong>
                </div>
                <div className="console-cell">
                  <span className="mono-label">Threshold</span>
                  <strong>
                    {liveProduct
                      ? `< ${formatFeedUnits(liveProduct.triggerBelow)}`
                      : "Waiting for live read"}
                  </strong>
                </div>
                <div className="console-cell">
                  <span className="mono-label">Proof type</span>
                  <strong>EVM-v1 receipt</strong>
                </div>
                <div className="console-cell">
                  <span className="mono-label">Receipt log</span>
                  <strong>position 2 / success</strong>
                </div>
              </div>
            </div>
          </aside>
        </section>

        <section className="section" id="pool">
          <div className="section-heading">
            <h2>Capital is visible before the promise is made.</h2>
            <p>
              Every policy reserves coverage against accounted TestUSD capital.
              Direct donations, fees, and free capacity never disappear into a
              black box.
            </p>
          </div>
          <div className="metrics" aria-label="Pool metrics">
            <div className="metric">
              <span className="mono-label">Accounted capital</span>
              <strong className="metric-value">
                {liveAccountedCapital === undefined
                  ? "N/A"
                  : formatTokenUnits(liveAccountedCapital)}
              </strong>
              <span className="metric-detail">
                {poolPending
                  ? "deployment manifest pending"
                  : poolReadUnavailable
                    ? "CC3 read unavailable"
                    : "TestUSD · six decimals"}
              </span>
            </div>
            <div className="metric">
              <span className="mono-label">Reserved</span>
              <strong className="metric-value">
                {liveReservedCapital === undefined
                  ? "N/A"
                  : formatTokenUnits(liveReservedCapital)}
              </strong>
              <span className="metric-detail">
                {poolPending
                  ? "deployment manifest pending"
                  : poolReadUnavailable
                    ? "CC3 read unavailable"
                    : liveAccountedCapital && liveReservedCapital
                      ? `${((Number(liveReservedCapital) / Number(liveAccountedCapital)) * 100).toFixed(1)}% of capital`
                      : "waiting for first read"}
              </span>
            </div>
            <div className="metric">
              <span className="mono-label">Free capacity</span>
              <strong className="metric-value">
                {liveAccountedCapital === undefined ||
                liveReservedCapital === undefined
                  ? "N/A"
                  : formatTokenUnits(
                      liveAccountedCapital - liveReservedCapital,
                    )}
              </strong>
              <span className="metric-detail">
                {poolPending
                  ? "deployment manifest pending"
                  : poolReadUnavailable
                    ? "CC3 read unavailable"
                    : "available to reserve"}
              </span>
            </div>
            <div className="metric">
              <span className="mono-label">Policies</span>
              <strong className="metric-value">
                {livePolicyCount === undefined
                  ? "N/A"
                  : (livePolicyCount - 1n).toString()}
              </strong>
              <span className="metric-detail">
                {poolPending
                  ? "deployment manifest pending"
                  : poolReadUnavailable
                    ? "CC3 read unavailable"
                    : "total created"}
              </span>
            </div>
          </div>
        </section>

        <section className="section" id="product">
          <div className="section-heading">
            <h2>One clear product. One deterministic trigger.</h2>
            <p>
              The demo product is intentionally conservative and visibly
              labeled. Terms are fixed when created; a policy stores its own
              chronology. Values below are read from the live CC3 product when
              available.
            </p>
          </div>
          <div className="product-layout">
            <article className="product-card">
              <div className="product-title-row">
                <div>
                  <span className="mono-label">Product 01</span>
                  <h3 className="product-title">USDC depeg cover</h3>
                </div>
                <span className="demo-tag">Demo only</span>
              </div>
              <p className="product-copy">
                Pays fixed coverage after two independently verified in-window
                AnswerUpdated events remain below the threshold for the minimum
                duration.
              </p>
              <div className="terms">
                <div className="term">
                  <span className="mono-label">Source</span>
                  <strong className="term-value">Ethereum / chain key 3</strong>
                </div>
                <div className="term">
                  <span className="mono-label">Aggregator</span>
                  <strong className="term-value">0xc9E1…fE9d7</strong>
                </div>
                <div className="term">
                  <span className="mono-label">Trigger</span>
                  <strong className="term-value">
                    {liveProduct
                      ? `< ${formatFeedUnits(liveProduct.triggerBelow)}`
                      : "not deployed"}
                  </strong>
                </div>
                <div className="term">
                  <span className="mono-label">Premium</span>
                  <strong className="term-value">
                    {liveProduct
                      ? `${(liveProduct.premiumBps / 100).toFixed(2)}% one-time`
                      : "illustrative · 2.50%"}
                  </strong>
                </div>
                <div className="term">
                  <span className="mono-label">Activation</span>
                  <strong className="term-value">
                    {liveProduct
                      ? formatDuration(liveProduct.activationDelay)
                      : "illustrative · 30 seconds"}
                  </strong>
                </div>
                <div className="term">
                  <span className="mono-label">Minimum breach</span>
                  <strong className="term-value">
                    {liveProduct
                      ? formatDuration(liveProduct.minBreachDuration)
                      : "illustrative · 5 minutes"}
                  </strong>
                </div>
              </div>
            </article>
            <form
              className="purchase-card"
              onSubmit={previewPurchase}
              aria-labelledby="purchase-heading"
            >
              <span className="mono-label">Policy purchase</span>
              <h3 id="purchase-heading">Price a protection window</h3>
              <p className="purchase-intro">
                {poolPending
                  ? "Connect a CC3 wallet to preview the exact contract call."
                  : "Approve the exact premium, then submit the simulated purchase from your CC3 wallet."}
              </p>
              <div className="field">
                <label htmlFor="coverage">Coverage amount (TestUSD)</label>
                <input
                  id="coverage"
                  inputMode="decimal"
                  min="1"
                  max="500000"
                  step="0.01"
                  value={coverage}
                  aria-describedby="coverage-help"
                  aria-invalid={coverage !== "" && !validCoverage}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setCoverage(event.target.value)
                  }
                />
                <small id="coverage-help">
                  {liveProduct
                    ? `Maximum per policy: ${formatTokenUnits(liveProduct.maxCoveragePerPolicy)}. Premium rounds upward on-chain.`
                    : "Maximum and premium are unavailable until the live product is read."}
                </small>
              </div>
              <div className="field">
                <label htmlFor="beneficiary">Beneficiary address</label>
                <input
                  id="beneficiary"
                  placeholder="0x…"
                  value={beneficiary}
                  aria-describedby="beneficiary-help"
                  aria-invalid={beneficiary.length > 0 && !beneficiaryIsValid}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setBeneficiary(event.target.value)
                  }
                />
                <small id="beneficiary-help">
                  The beneficiary is stored at purchase and cannot be selected
                  by a claim relayer.
                </small>
              </div>
              {liveProduct && (
                <div className="purchase-summary">
                  <h4>Your policy, before you buy</h4>
                  <p>
                    Fixed payout:{" "}
                    <strong>
                      {coverageUnits ? formatUnits(coverageUnits, 6) : "—"}{" "}
                      TestUSD
                    </strong>
                    . One-time premium:{" "}
                    <strong>
                      {quotedPremium !== undefined
                        ? formatUnits(quotedPremium, 6)
                        : "—"}{" "}
                      TestUSD
                    </strong>
                    .
                  </p>
                  <p>
                    Coverage starts{" "}
                    {formatDuration(liveProduct.activationDelay)} after purchase
                    and lasts {formatDuration(liveProduct.policyDuration)}.
                    Submit a qualifying claim within{" "}
                    {formatDuration(liveProduct.claimGracePeriod)} after
                    coverage ends.
                  </p>
                  <p>
                    Requires two USDC/USD observations below{" "}
                    {formatFeedUnits(liveProduct.triggerBelow)}, at least{" "}
                    {formatDuration(liveProduct.minBreachDuration)} apart,
                    during coverage. This is a demonstration threshold.
                  </p>
                  <p className="beneficiary-summary">
                    Pays:{" "}
                    {beneficiaryIsValid
                      ? beneficiary
                      : "Enter the beneficiary address above"}
                  </p>
                </div>
              )}
              {connected && (
                <div
                  className="wallet-facts"
                  aria-label="Wallet TestUSD status"
                >
                  <span>
                    Wallet balance:{" "}
                    {walletTokenBalance === undefined
                      ? "reading…"
                      : formatTokenUnits(walletTokenBalance)}
                  </span>
                  <span>
                    Allowance:{" "}
                    {walletTokenAllowance === undefined
                      ? "reading…"
                      : formatTokenUnits(walletTokenAllowance)}
                  </span>
                </div>
              )}
              <div className="quote-row">
                <div>
                  <span className="mono-label">Quoted premium</span>
                  <strong>
                    {quotedPremium === undefined
                      ? poolPending
                        ? formatUsd(illustrativePremium)
                        : "N/A"
                      : formatTokenUnits(quotedPremium)}
                  </strong>
                </div>
                <button
                  className="button"
                  type="submit"
                  disabled={
                    !connected ||
                    !PEGSHIELD_POOL_ADDRESS ||
                    !beneficiaryIsValid ||
                    coverageUnits === undefined ||
                    coverageUnits <= 0n ||
                    coverageAboveMaximum ||
                    tokenReadsPending ||
                    quotedPremium === undefined ||
                    walletTokenBalance === undefined ||
                    walletTokenBalance < quotedPremium ||
                    (walletTokenAllowance !== undefined &&
                      walletTokenAllowance >= quotedPremium &&
                      (effectiveSimulationPending ||
                        !purchaseSimulation?.request)) ||
                    purchaseStatus === "approving" ||
                    purchaseStatus === "purchasing" ||
                    (purchaseStatus === "approval-confirmed" &&
                      (walletTokenAllowance === undefined ||
                        quotedPremium === undefined ||
                        walletTokenAllowance < quotedPremium))
                  }
                >
                  {purchaseStatus === "approving"
                    ? "Approving…"
                    : purchaseStatus === "purchasing"
                      ? "Purchasing…"
                      : walletTokenAllowance !== undefined &&
                          quotedPremium !== undefined &&
                          walletTokenAllowance < quotedPremium
                        ? "Approve TestUSD"
                        : effectiveSimulationPending
                          ? "Simulating…"
                          : "Purchase policy"}
                </button>
              </div>
              <p
                className={`purchase-status ${purchaseStatus === "confirmed" ? "success" : ""}`}
                role="status"
                aria-live="polite"
              >
                {poolPending
                  ? "Purchase unavailable until a live CC3 pool is configured"
                  : !connected
                    ? "Connect a CC3 wallet to approve and purchase"
                    : !validCoverage
                      ? "Enter a valid coverage amount (up to six decimals)"
                      : coverageAboveMaximum
                        ? "Coverage exceeds the live product maximum"
                        : !beneficiaryIsValid
                          ? "Enter a valid beneficiary address"
                          : tokenReadsPending
                            ? "Reading TestUSD balance and allowance…"
                            : walletTokenBalance === undefined ||
                                quotedPremium === undefined
                              ? "Waiting for the live token and premium reads"
                              : walletTokenBalance < quotedPremium
                                ? "Insufficient TestUSD balance for this premium"
                                : purchaseStatus === "approving"
                                  ? "Approve the exact premium in your wallet…"
                                  : purchaseStatus === "approval-confirmed"
                                    ? walletTokenAllowance !== undefined &&
                                      quotedPremium !== undefined &&
                                      walletTokenAllowance >= quotedPremium
                                      ? "Approval confirmed · click Purchase policy to continue"
                                      : "Approval confirmed · refreshing allowance…"
                                    : purchaseStatus === "purchasing"
                                      ? "Confirm the policy purchase in your wallet…"
                                      : purchaseStatus === "confirmed"
                                        ? "Policy purchased · selected policy refreshed from CC3"
                                        : purchaseError
                                          ? purchaseError
                                          : effectiveSimulationPending
                                            ? "Checking allowance, capital, and product terms…"
                                            : purchaseSimulation?.request
                                              ? "Simulation passed · ready for wallet confirmation"
                                              : simulationError
                                                ? "Simulation rejected · inspect balance, allowance, and capacity"
                                                : quotedPremiumError
                                                  ? "Premium quote rejected by CC3; adjust coverage"
                                                  : "Waiting for the CC3 simulation result"}
              </p>
            </form>
          </div>
        </section>

        <CompletedPayout />
        <section className="section" id="policy">
          <div className="section-heading">
            <h2>Selected policy, from activation to settlement.</h2>
            <p>
              Track your coverage and check for a payout. A qualifying pair must
              occur during coverage and meet the minimum observation interval;
              the next oracle update time is not guaranteed.
            </p>
          </div>
          <div className="timeline-layout">
            <div className="timeline" aria-label="Policy lifecycle">
              <div className={`timeline-step ${hasLivePolicy ? "done" : ""}`}>
                <h3>{hasLivePolicy ? "Purchased" : "No live policy loaded"}</h3>
                <p>
                  {hasLivePolicy
                    ? "Coverage locked to the beneficiary; premium added to accounted capital."
                    : "Configure a deployment manifest to read purchase state from CC3."}
                </p>
                <span className="timeline-meta">
                  {hasLivePolicy
                    ? `policy ${selectedPolicyId.toString().padStart(2, "0")} / coverage ${formatTokenUnits(livePolicy?.coverage ?? 0n)} / ${policyStateLabel}`
                    : "deployment manifest pending"}
                </span>
              </div>
              <div
                className={`timeline-step ${activationComplete ? "done" : ""}`}
              >
                <h3>Activation window</h3>
                <p>
                  Source events before activation are rejected even when the
                  proof itself is valid.
                </p>
                <span className="timeline-meta">
                  {hasLivePolicy
                    ? `Starts ${new Date(Number(livePolicy!.startsAt) * 1000).toLocaleString()}`
                    : "activation is read from chain"}
                </span>
              </div>
              <div
                className={`timeline-step ${hasLivePolicy && !terminalPolicy ? "active" : ""}`}
              >
                <h3>
                  {terminalPolicy
                    ? "Observation checks complete"
                    : "Track qualifying observations"}
                </h3>
                <p>
                  We check for two qualifying price observations automatically.
                  The minimum interval is not a countdown to a guaranteed
                  payout.
                </p>
                <span className="timeline-meta">
                  {hasLivePolicy
                    ? `${policyStateLabel} · relayer permissionless`
                    : "live claim state unavailable"}
                </span>
              </div>
              <div className={`timeline-step ${terminalPolicy ? "done" : ""}`}>
                <h3>Claimed or expired</h3>
                <p>
                  Effects happen before transfer; expiry releases reserve after
                  the grace deadline.
                </p>
                <span className="timeline-meta">
                  {hasLivePolicy
                    ? `${policyStateLabel} · no replay`
                    : "terminal state is not loaded"}
                </span>
              </div>
            </div>
            <aside className="evidence-card" id="evidence">
              <span className="mono-label">Evidence snapshot</span>
              <h3>Independent facts, one panel.</h3>
              <dl className="evidence-list">
                <div className="evidence-row">
                  <dt>Source transaction</dt>
                  <dd>
                    <a
                      className="evidence-link"
                      href={`${SOURCE_EXPLORER}/${SOURCE_TX}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {SOURCE_TX.slice(0, 10)}…
                    </a>
                  </dd>
                </div>
                <div className="evidence-row">
                  <dt>Source event</dt>
                  <dd>answer 99,989,777 · round 1166</dd>
                </div>
                <div className="evidence-row">
                  <dt>Source timestamp</dt>
                  <dd>2026-09-01 08:00:11 UTC · fixture-only</dd>
                </div>
                <div className="evidence-row">
                  <dt>RPC block log</dt>
                  <dd>516</dd>
                </div>
                <div className="evidence-row">
                  <dt>Receipt position</dt>
                  <dd>2</dd>
                </div>
                <div className="evidence-row">
                  <dt>Proof checksum</dt>
                  <dd>sha256:88d6ab63…dec6764</dd>
                </div>
                <div className="evidence-row">
                  <dt>CC3 settlement</dt>
                  <dd>
                    {poolPending
                      ? "pending live deployment"
                      : poolReadUnavailable
                        ? "configured · CC3 read unavailable"
                        : "configured · no fixture settlement claim"}
                  </dd>
                </div>
              </dl>
              <p className="evidence-note">
                This historical source event is a decoder/proof fixture, not a
                claim-eligible observation for a later policy.
              </p>
            </aside>
          </div>
          <article className="claim-card" aria-labelledby="claim-heading">
            <div className="claim-card-header">
              <div>
                <span className="mono-label">Your payout</span>
                <h3 id="claim-heading">Prepare your claim</h3>
              </div>
              <span className="demo-tag">Atomic claim</span>
            </div>
            <p className="claim-intro">
              We find qualifying observations and prepare the evidence for you.
              Creditcoin checks your claim before you confirm a transaction in
              your wallet.
            </p>
            {hasLivePolicy && (
              <ClaimProgress
                key={selectedPolicyId.toString()}
                policyId={selectedPolicyId.toString()}
                enabled={Boolean(PEGSHIELD_POOL_ADDRESS)}
                onPrepared={acceptPrepared}
                simulationFailed={claimSimulationError || proofTooOld}
                submitting={claimStatus === "submitting"}
              />
            )}
            {hasLivePolicy && (
              <dl className="claim-facts policy-summary">
                <div>
                  <dt>Fixed coverage</dt>
                  <dd>{formatUnits(livePolicy!.coverage, 6)} TestUSD</dd>
                </div>
                <div>
                  <dt>Premium paid</dt>
                  <dd>{formatUnits(livePolicy!.premium, 6)} TestUSD</dd>
                </div>
                <div>
                  <dt>Locked beneficiary</dt>
                  <dd>{livePolicy!.beneficiary}</dd>
                </div>
                <div>
                  <dt>Coverage ends</dt>
                  <dd>
                    {new Date(
                      Number(livePolicy!.endsAt) * 1000,
                    ).toLocaleString()}
                  </dd>
                </div>
              </dl>
            )}
            <details className="advanced-proofs">
              <summary>Advanced: inspect or upload proof files</summary>
              <div className="field">
                <label htmlFor="first-proof-artifact">
                  First observation proof
                </label>
                <input
                  id="first-proof-artifact"
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => void handleProofFile("first", event)}
                  aria-describedby="first-proof-artifact-help"
                />
                <small id="first-proof-artifact-help">
                  Maximum 256 KiB. The artifact must use the pinned Ethereum
                  aggregator and AnswerUpdated topic.
                </small>
              </div>
              {firstClaimArtifact && (
                <dl className="claim-facts">
                  <div>
                    <dt>First file</dt>
                    <dd>{firstClaimArtifactName ?? "proof.json"}</dd>
                  </div>
                  <div>
                    <dt>First event</dt>
                    <dd>
                      round {firstClaimArtifact.decodedExpected.roundId} ·
                      answer {firstClaimArtifact.decodedExpected.answer}
                    </dd>
                  </div>
                  <div>
                    <dt>First proof digest</dt>
                    <dd>{proofDigest(firstClaimArtifact)}</dd>
                  </div>
                </dl>
              )}
              {firstClaimArtifactError && (
                <p className="claim-status error" role="alert">
                  {firstClaimArtifactError}
                </p>
              )}
              <div className="field">
                <label htmlFor="confirmation-proof-artifact">
                  Confirmation observation proof
                </label>
                <input
                  id="confirmation-proof-artifact"
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) =>
                    void handleProofFile("confirmation", event)
                  }
                  aria-describedby="confirmation-proof-artifact-help"
                />
                <small id="confirmation-proof-artifact-help">
                  Must be a distinct later round and satisfy the product’s
                  minimum observation interval.
                </small>
              </div>
              {confirmationClaimArtifact && (
                <dl className="claim-facts">
                  <div>
                    <dt>Confirmation file</dt>
                    <dd>{confirmationClaimArtifactName ?? "proof.json"}</dd>
                  </div>
                  <div>
                    <dt>Confirmation event</dt>
                    <dd>
                      round {confirmationClaimArtifact.decodedExpected.roundId}{" "}
                      · answer{" "}
                      {confirmationClaimArtifact.decodedExpected.answer}
                    </dd>
                  </div>
                  <div>
                    <dt>Confirmation digest</dt>
                    <dd>{proofDigest(confirmationClaimArtifact)}</dd>
                  </div>
                </dl>
              )}
              {confirmationClaimArtifactError && (
                <p className="claim-status error" role="alert">
                  {confirmationClaimArtifactError}
                </p>
              )}
            </details>
            <div className="claim-actions">
              <p className="claim-status" role="status" aria-live="polite">
                {terminalPolicy
                  ? policyStateLabel === "Claimed"
                    ? "Payout completed. This policy cannot pay twice."
                    : "This policy has expired."
                  : proofTooOld
                    ? "Evidence needs refreshing. Use Prepare claim again before signing."
                    : !connected
                      ? "Connect a CC3 wallet to simulate a claim"
                      : !hasLivePolicy
                        ? "Select a live policy before loading a proof"
                        : !firstClaimArtifact || !confirmationClaimArtifact
                          ? "Once two observations qualify, select Prepare claim above."
                          : claimStatus === "validating"
                            ? "Validating artifact checksum…"
                            : claimSimulationPending
                              ? "Simulating proof against CC3…"
                              : claimSimulation?.request
                                ? `Simulation passed · ${claimGasLimit ? "ready for your wallet confirmation" : "estimating transaction cost"}`
                                : claimSimulationError
                                  ? `Simulation rejected · ${describeError(claimSimulationErrorValue)}`
                                  : claimGasError
                                    ? "CC3 gas estimation failed; nothing can be submitted"
                                    : "Waiting for the CC3 simulation result"}
              </p>
              <button
                className="button"
                type="button"
                onClick={submitClaimProof}
                disabled={
                  !connected ||
                  terminalPolicy ||
                  proofTooOld ||
                  claimSimulationError ||
                  !claimSimulation?.request ||
                  !claimGasLimit ||
                  claimStatus === "submitting" ||
                  claimStatus === "validating"
                }
              >
                {claimStatus === "submitting" ? "Submitting…" : "Claim payout"}
              </button>
            </div>
            {claimStatus === "confirmed" && claimWriter.data && (
              <p className="claim-status success" role="status">
                {formatUnits(livePolicy?.coverage ?? 0n, 6)} TestUSD paid to{" "}
                {livePolicy?.beneficiary}.{" "}
                <a
                  href={`https://creditcoin-testnet.blockscout.com/tx/${claimWriter.data}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View payout receipt ↗
                </a>
              </p>
            )}
            {claimStatus === "error" && claimError && (
              <p className="claim-status error" role="alert">
                {claimError}
              </p>
            )}
          </article>
        </section>

        <section className="section">
          <div className="section-heading">
            <h2>Three boundaries. No hidden oracle.</h2>
            <p>
              Attestcoin authenticates the source receipt; PegShield decodes one
              locked event; the pool applies immutable policy predicates.
            </p>
          </div>
          <div className="architecture">
            <article className="architecture-item">
              <span className="architecture-number">01 / SOURCE</span>
              <h3>Ethereum + Attestcoin</h3>
              <p>
                Proof commits to the exact transaction, receipt, Merkle path,
                and continuity roots.
              </p>
            </article>
            <article className="architecture-item">
              <span className="architecture-number">02 / ADAPTER</span>
              <h3>Authenticated log</h3>
              <p>
                One EVM-v1 receipt chunk is decoded; failed receipts and
                malformed topics never become observations.
              </p>
            </article>
            <article className="architecture-item">
              <span className="architecture-number">03 / POOL</span>
              <h3>Reserve + payout</h3>
              <p>
                Chronology, replay, reserve accounting, and immutable
                beneficiary rules are enforced on CC3.
              </p>
            </article>
          </div>
        </section>

        <section className="section" id="trust">
          <div className="trust-grid">
            <article className="trust-card">
              <span className="mono-label">What the prototype trusts</span>
              <h3>Public protocol dependencies</h3>
              <p>
                CC3’s pinned BlockProver and decoder, Ethereum receipt data, and
                the underwriter’s deposited TestUSD capital. These addresses and
                hashes are locked in the repository.
              </p>
            </article>
            <article className="trust-card">
              <span className="mono-label">What it does not trust</span>
              <h3>Relayer honesty or UI state</h3>
              <p>
                Anyone can relay a proof, but the UI cannot invent a breach. The
                chain verifies the event, timing, threshold, replay status, and
                payout state independently.
              </p>
            </article>
          </div>
        </section>

        <footer className="footer">
          <span>PEGSHIELD / TESTNET DEMO / CC3 102031</span>
          <span>TestUSD is not a production stablecoin.</span>
        </footer>
      </div>
    </main>
  );
}
