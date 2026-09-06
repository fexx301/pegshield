"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { eligibilityCopy, type Eligibility } from "../lib/eligibility";
import { validateProofArtifact, type ProofArtifact } from "../lib/proof";

export function ClaimProgress({
  policyId,
  enabled,
  onPrepared,
  simulationFailed,
  submitting,
}: {
  policyId: string;
  enabled: boolean;
  onPrepared: (artifacts?: [ProofArtifact, ProofArtifact]) => void;
  simulationFailed: boolean;
  submitting: boolean;
}) {
  const [result, setResult] = useState<Eligibility>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<"checking" | "preparing">();
  const request = useRef<AbortController | undefined>(undefined);
  const refreshed = useRef(false);
  const [prepared, setPrepared] = useState(false);

  const run = useCallback(
    async (prepare: boolean) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setBusy(prepare ? "preparing" : "checking");
      setError(undefined);
      if (prepare) {
        onPrepared();
        setPrepared(false);
      }
      try {
        const response = await fetch(`/api/claims/${policyId}`, {
          method: prepare ? "POST" : "GET",
          signal: controller.signal,
          cache: "no-store",
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            body.error ?? "The network check failed. Try again shortly.",
          );
        if (!body.eligibility || !(body.eligibility.status in eligibilityCopy))
          throw new Error(
            "The network returned an incomplete response. Please retry.",
          );
        if (controller.signal.aborted) return;
        setResult(body.eligibility);
        if (
          prepare &&
          Array.isArray(body.artifacts) &&
          body.artifacts.length === 2
        ) {
          const first = await validateProofArtifact(body.artifacts[0]);
          const second = await validateProofArtifact(body.artifacts[1]);
          if (controller.signal.aborted) return;
          onPrepared([first.artifact, second.artifact]);
          setPrepared(true);
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Couldn’t check your policy. Please retry.",
          );
      } finally {
        if (!controller.signal.aborted) {
          setBusy(undefined);
          request.current = undefined;
        }
      }
    },
    [policyId, onPrepared],
  );

  useEffect(() => {
    if (!enabled) return;
    void run(false);
    const timer = setInterval(() => {
      if (
        !submitting &&
        !request.current &&
        document.visibilityState === "visible"
      )
        void run(false);
    }, 60000);
    return () => {
      clearInterval(timer);
      request.current?.abort();
    };
  }, [enabled, run, submitting]);

  useEffect(() => {
    if (simulationFailed && prepared && !refreshed.current && !submitting) {
      refreshed.current = true;
      void run(true);
    }
  }, [simulationFailed, prepared, submitting, run]);

  const copy = result
    ? eligibilityCopy[result.status]
    : [
        "Check your policy",
        "We’ll look for qualifying Ethereum observations automatically.",
      ];
  return (
    <div className="claim-progress" aria-busy={Boolean(busy)}>
      <div role="status" aria-live="polite">
        <span className="mono-label">Policy {policyId} · automatic checks</span>
        <h4>
          {busy === "preparing" ? "Preparing current evidence…" : copy[0]}
        </h4>
        <p>
          {busy === "preparing"
            ? "Fetching both proofs, then checking your claim on Creditcoin. This can take up to a minute."
            : copy[1]}
        </p>
      </div>
      {result && result.observations.length > 0 && (
        <ol className="observation-list">
          {result.observations.map((observation, index) => (
            <li key={observation.transactionHash}>
              <span>{index === 0 ? "First observation" : "Confirmation"}</span>
              <strong>${formatUnits(BigInt(observation.answer), 8)}</strong>
              <time
                dateTime={new Date(observation.updatedAt * 1000).toISOString()}
              >
                {new Date(observation.updatedAt * 1000).toLocaleString()}
              </time>
              <a
                href={`https://etherscan.io/tx/${observation.transactionHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View Ethereum event ↗
              </a>
            </li>
          ))}
        </ol>
      )}
      {error && (
        <p className="claim-status error" role="alert">
          {error}
        </p>
      )}
      <div className="hero-actions">
        {(!result ||
          !["claimed", "expired", "closed"].includes(result.status)) && (
          <button
            type="button"
            className="button"
            disabled={
              !enabled ||
              Boolean(busy) ||
              submitting ||
              result?.status !== "eligible"
            }
            onClick={() => {
              refreshed.current = false;
              void run(true);
            }}
          >
            {busy === "preparing"
              ? "Preparing…"
              : prepared
                ? "Refresh claim evidence"
                : "Prepare claim"}
          </button>
        )}
        <button
          type="button"
          className="button ghost"
          disabled={!enabled || Boolean(busy) || submitting}
          onClick={() => void run(false)}
        >
          {busy === "checking"
            ? "Checking network…"
            : error
              ? "Retry network check"
              : "Check now"}
        </button>
      </div>
      {result && (
        <p className="field-help">
          Last checked {new Date(result.checkedAt).toLocaleTimeString()}. Checks
          refresh every minute while this page is visible.
        </p>
      )}
    </div>
  );
}
