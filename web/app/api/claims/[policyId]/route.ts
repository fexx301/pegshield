import {
  discoverClaim,
  PolicyNotFoundError,
  prepareClaim,
} from "../../../../lib/claim-service";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
let active = 0;
const pending = new Map<string, Promise<unknown>>();
const cache = new Map<string, { until: number; value: unknown }>();
// In-memory, per-instance rate limiting for public GET discovery — not a
// distributed rate limiter, matching the README's stance on instance limits.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const RATE_LIMIT_MAX_IDENTITIES = 1024;
const requestsByIdentity = new Map<string, number[]>();

function allowGet(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-for");
  const identity = forwarded?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  if (
    requestsByIdentity.size >= RATE_LIMIT_MAX_IDENTITIES &&
    !requestsByIdentity.has(identity)
  ) {
    // Evict identities whose whole window has expired before rejecting new
    // ones at the bounded-map cap.
    for (const [key, stamps] of requestsByIdentity)
      if (stamps.every((stamp) => now - stamp >= RATE_LIMIT_WINDOW_MS))
        requestsByIdentity.delete(key);
    if (requestsByIdentity.size >= RATE_LIMIT_MAX_IDENTITIES) return false;
  }
  const stamps = (requestsByIdentity.get(identity) ?? []).filter(
    (stamp) => now - stamp < RATE_LIMIT_WINDOW_MS,
  );
  if (stamps.length >= RATE_LIMIT_MAX_REQUESTS) return false;
  stamps.push(now);
  requestsByIdentity.set(identity, stamps);
  return true;
}

async function handle(
  request: Request,
  context: { params: Promise<{ policyId: string }> },
) {
  const { policyId } = await context.params;
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!/^[1-9][0-9]{0,9}$/.test(policyId))
    return reply({ error: "Enter a valid policy number." }, 400);
  if (
    request.method === "POST" &&
    request.headers.get("origin") &&
    request.headers.get("origin") !== new URL(request.url).origin
  )
    return reply(
      { error: "Prepare claims from the PegShield dashboard." },
      403,
    );
  if (request.method === "GET" && !allowGet(request))
    return reply(
      {
        error: "Too many policy checks. Please wait a minute and try again.",
      },
      429,
    );
  const key = `${request.method}:${policyId}`;
  const cached = cache.get(key);
  if (request.method === "GET" && cached && cached.until > Date.now())
    return reply(cached.value);
  let job = pending.get(key);
  if (!job) {
    if (active >= 4)
      return reply(
        { error: "The service is busy. Please retry in a minute." },
        503,
      );
    active++;
    const signal = AbortSignal.timeout(55000);
    job = (
      request.method === "POST"
        ? prepareClaim(BigInt(policyId), signal)
        : discoverClaim(BigInt(policyId), signal).then(({ eligibility }) => ({
            eligibility,
          }))
    ).finally(() => {
      active--;
      pending.delete(key);
    });
    pending.set(key, job);
  }
  try {
    const value = await job;
    if (request.method === "GET") {
      cache.delete(key); // Re-set keys move to the end (LRU-ish eviction).
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(key, { until: Date.now() + 30000, value });
    }
    return reply(value);
  } catch (error) {
    if (error instanceof PolicyNotFoundError)
      return reply({ error: "Policy not found." }, 404);
    // Do not return upstream exceptions: RPC URLs may contain credentials.
    // Keep a redacted first-line diagnostic in platform logs for operators.
    // The client still receives the same recovery-safe message.
    const detail = error instanceof Error ? error.message : "unknown";
    console.error(
      "claim service failure",
      (detail.split("\n", 1)[0] ?? detail).replace(
        /https?:\/\/[^\s]+/g,
        "[upstream URL]",
      ),
    );
    return reply(
      {
        error:
          "We couldn’t check the network or prepare evidence. Please retry shortly. Your policy and funds are unchanged.",
      },
      502,
    );
  }
}
export const GET = handle;
export const POST = handle;
