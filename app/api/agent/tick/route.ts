import { after } from "next/server";
import { runTick } from "@/lib/tick";
import { ok, fail } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/agent/tick — requires `Authorization: Bearer $CRON_SECRET`.
 *
 * The second scheduler. GitHub Actions runs at 9,39 past the hour; an external
 * pinger hits this at 24,54, interleaved so that if either line dies the other
 * covers the gap within about fifteen minutes. Both run permanently — over a
 * multi-day unattended judging window the likeliest failure is one free
 * scheduler quietly stopping, and redundancy is only redundancy if it is
 * already running when that happens.
 *
 * Running both is safe because runTick() takes a Mongo lease first; whichever
 * arrives second exits without doing anything.
 *
 * It answers 202 immediately and does the work in after(). A full cycle takes
 * around 30 seconds, and cron-job.org's free tier abandons a request at 30 —
 * so a synchronous response would have been recorded as a failure on almost
 * every run, and a scheduler that always looks broken is one nobody checks.
 * Pass ?wait=1 to block on the report instead, which is what a human debugging
 * it actually wants.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const presented = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!secret || presented !== secret) {
    return fail(401, "unauthorized", "A valid bearer token is required.");
  }

  const wait = new URL(req.url).searchParams.get("wait") === "1";

  if (wait) {
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

  after(async () => {
    try {
      await runTick({ trigger: "http", deadline: Date.now() + 45_000 });
    } catch (err) {
      // The response is already sent; the runs collection is the record.
      console.error("tick failed:", err);
    }
  });

  return ok({ accepted: true, trigger: "http" }, 202);
}
