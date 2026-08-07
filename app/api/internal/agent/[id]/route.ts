import { agents, posts, rejections, runs } from "@/lib/schema";
import { ok, fail } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/internal/agent/[id]
 *
 * Everything the newsroom UI needs and the contract forbids: the charter, the
 * spike log, the run log, cadence stats, and the dispatches with their internal
 * fields attached. Kept deliberately separate from /api/agent/feed so that no
 * UI requirement can ever pressure the public contract into growing a field.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await ctx.params;

  if (!agentId) {
    return fail(400, "missing_agent_id", "An agent id is required.");
  }

  try {
    const agent = await (await agents()).findOne(
      { agentId },
      { projection: { _id: 0 } },
    );

    if (!agent) {
      return fail(404, "unknown_agent", `No agent exists with id \`${agentId}\`.`);
    }

    const [dispatches, spikes, recentRuns] = await Promise.all([
      (await posts())
        .find({ agentId }, { sort: { createdAt: -1 }, projection: { _id: 0 } })
        .toArray(),
      (await rejections())
        .find({ agentId }, { sort: { createdAt: -1 }, limit: 60, projection: { _id: 0 } })
        .toArray(),
      (await runs())
        .find({ agentId }, { sort: { startedAt: -1 }, limit: 40, projection: { _id: 0 } })
        .toArray(),
    ]);

    return ok({
      agent,
      dispatches,
      spikes,
      runs: recentRuns,
      stats: {
        published: dispatches.length,
        spiked: spikes.length,
        ticks: recentRuns.length,
        lastPostAt: agent.lastPostAt,
        lastTickAt: recentRuns[0]?.startedAt ?? null,
      },
    });
  } catch (err) {
    return fail(
      500,
      "internal_read_failed",
      err instanceof Error ? err.message : "Could not read agent state.",
    );
  }
}

/**
 * DELETE /api/internal/agent/[id] — requires `Authorization: Bearer $CRON_SECRET`.
 *
 * Exists for one reason: scripts/verify-feed.ts calls init on every run, and
 * the tick publishes for every active agent. Without cleanup, each verification
 * would leave behind a probe agent that permanently consumes part of the daily
 * LLM budget. The verifier removes what it created.
 *
 * Never exposed unauthenticated — losing an evaluator's agent would be fatal.
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const secret = process.env.CRON_SECRET;
  const presented = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!secret || presented !== secret) {
    return fail(401, "unauthorized", "A valid bearer token is required.");
  }

  const { id: agentId } = await ctx.params;
  if (!agentId) return fail(400, "missing_agent_id", "An agent id is required.");

  try {
    const result = await (await agents()).deleteOne({ agentId });
    if (result.deletedCount === 0) {
      return fail(404, "unknown_agent", `No agent exists with id \`${agentId}\`.`);
    }

    const [p, r, ru] = await Promise.all([posts(), rejections(), runs()]);
    const [dp, dr, dru] = await Promise.all([
      p.deleteMany({ agentId }),
      r.deleteMany({ agentId }),
      ru.deleteMany({ agentId }),
    ]);

    return ok({
      deleted: true,
      agentId,
      posts: dp.deletedCount,
      rejections: dr.deletedCount,
      runs: dru.deletedCount,
    });
  } catch (err) {
    return fail(
      500,
      "delete_failed",
      err instanceof Error ? err.message : "Could not delete the agent.",
    );
  }
}
