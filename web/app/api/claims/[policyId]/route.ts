import { discoverClaim, prepareClaim } from "../../../../lib/claim-service";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
let active = 0;
const pending = new Map<string, Promise<unknown>>();
const cache = new Map<string, { until: number; value: unknown }>();

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
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(key, { until: Date.now() + 30000, value });
    }
    return reply(value);
  } catch {
    // Do not return upstream exceptions: RPC URLs may contain credentials.
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
