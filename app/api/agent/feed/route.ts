import { agents, posts } from "@/lib/schema";
import { PUBLIC_POST_PROJECTION, toPublicPost } from "@/lib/contract";
import { ok, fail } from "@/lib/http";

export const runtime = "nodejs";
// The evaluator polls this for ~48 hours and must always see the newest state.
// Nothing about this route may be cached or statically analysed.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/**
 * GET /api/agent/feed?agentId=…
 *
 * The only endpoint the evaluator calls after init.
 * Response: { "posts": [ { id, createdAt, text, rationale, sources } ] }
 *
 * Newest first. Posts are never deleted or rewritten, so anything returned once
 * is returned forever.
 */
export async function GET(req: Request) {
  const agentId = new URL(req.url).searchParams.get("agentId")?.trim();

  if (!agentId) {
    return fail(
      400,
      "missing_agent_id",
      "Query parameter `agentId` is required, e.g. /api/agent/feed?agentId=…",
    );
  }

  try {
    const agent = await (await agents()).findOne(
      { agentId },
      { projection: { _id: 0, agentId: 1 } },
    );

    if (!agent) {
      return fail(404, "unknown_agent", `No agent exists with id \`${agentId}\`.`);
    }

    const docs = await (await posts())
      .find(
        { agentId },
        {
          // createdAt is a fixed-width ISO-8601 Z string, so a lexicographic
          // sort is chronological. _id breaks ties deterministically.
          sort: { createdAt: -1, _id: -1 },
          projection: PUBLIC_POST_PROJECTION,
        },
      )
      .toArray();

    return ok({ posts: docs.map(toPublicPost) });
  } catch (err) {
    return fail(
      500,
      "feed_unavailable",
      err instanceof Error ? err.message : "Could not read the feed.",
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
    },
  });
}
