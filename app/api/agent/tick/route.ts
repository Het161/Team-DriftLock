import { runTick } from "@/lib/tick";
import { ok, fail } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/agent/tick — requires `Authorization: Bearer $CRON_SECRET`.
 *
 * The backup scheduler. GitHub Actions is the primary trigger; this exists so
 * an external pinger (cron-job.org, say) can keep the wire alive if Actions
 * lags or stops. Running both is safe because runTick() takes a Mongo lease
 * first — whichever arrives second exits without doing anything.
 *
 * Unlike the Actions path this one is time-boxed, so it hands runTick a
 * deadline and stops starting new agents rather than being killed mid-write.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const presented = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!secret || presented !== secret) {
    return fail(401, "unauthorized", "A valid bearer token is required.");
  }

  try {
    // Leave headroom under maxDuration for the in-flight agent to finish.
    const report = await runTick({ trigger: "http", deadline: Date.now() + 45_000 });
    return ok(report);
  } catch (err) {
    return fail(
      500,
      "tick_failed",
      err instanceof Error ? err.message : "The tick failed.",
    );
  }
}
