import { pingDb } from "@/lib/db";
import { agents, posts, runs, ensureIndexes } from "@/lib/schema";
import { ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Our own monitoring, not part of the evaluator contract. Answers the two
 * questions that actually matter during the build: is Atlas reachable from
 * this deployment, and is the tick still alive?
 *
 * Always 200 — a health endpoint that 500s tells you less than one that
 * reports which component is down.
 */
export async function GET() {
  const startedAt = Date.now();

  let db: "up" | "down" = "down";
  let latencyMs: number | null = null;
  let dbError: string | null = null;

  let agentCount = 0;
  let postCount = 0;
  let lastTickAt: string | null = null;
  let lastTickOutcome: string | null = null;

  /**
   * Last cycle per trigger.
   *
   * TAAR runs two schedulers in parallel on purpose — GitHub Actions and an
   * external pinger against /api/agent/tick — because over a five-day
   * unattended judging window the likeliest failure is one free scheduler
   * quietly stopping. A single `lastTickAt` cannot tell you that half the
   * redundancy died, since the surviving scheduler keeps it fresh. Splitting it
   * by trigger is what makes each line independently observable.
   */
  let lastRunByTrigger: Record<string, string | null> = {
    actions: null,
    http: null,
    manual: null,
  };

  try {
    latencyMs = await pingDb();
    db = "up";

    await ensureIndexes();

    const [a, p, r] = await Promise.all([agents(), posts(), runs()]);
    const [ac, pc, lastRun, triggers] = await Promise.all([
      a.countDocuments({}),
      p.countDocuments({}),
      r.find({}, { sort: { startedAt: -1 }, limit: 1 }).next(),
      r
        .aggregate<{ _id: string; lastAt: string }>([
          { $group: { _id: "$trigger", lastAt: { $max: "$startedAt" } } },
        ])
        .toArray(),
    ]);

    agentCount = ac;
    postCount = pc;
    lastTickAt = lastRun?.startedAt ?? null;
    lastTickOutcome = lastRun?.outcome ?? null;

    for (const t of triggers) {
      if (t._id) lastRunByTrigger[t._id] = t.lastAt ?? null;
    }
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  return ok({
    ok: db === "up",
    db,
    latencyMs,
    dbError,
    lastTickAt,
    lastTickOutcome,
    lastRunByTrigger,
    agents: agentCount,
    posts: postCount,
    checkedAt: new Date().toISOString(),
    tookMs: Date.now() - startedAt,
  });
}
