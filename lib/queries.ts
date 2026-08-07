import { agents, posts, rejections, runs } from "./schema";
import type { AgentDoc, PostDoc, RejectionDoc, RunDoc } from "./schema";

/**
 * Read models for the UI.
 *
 * Server components read Mongo directly rather than fetching our own HTTP API —
 * an internal round trip through the network would add latency and a failure
 * mode for no benefit. /api/internal/agent/[id] still exists for anything
 * client-side or external.
 *
 * Nothing here touches /api/agent/feed's five-field contract; these are the rich
 * documents, which is exactly why the UI never needed the public route to grow.
 */

export type WireData = {
  agent: AgentDoc;
  dispatches: PostDoc[];
};

export async function getAgent(agentId: string): Promise<AgentDoc | null> {
  return (await agents()).findOne({ agentId }, { projection: { _id: 0 } });
}

export async function getDispatches(agentId: string, limit = 100): Promise<PostDoc[]> {
  return (await posts())
    .find({ agentId }, { sort: { createdAt: -1 }, limit, projection: { _id: 0 } })
    .toArray();
}

export async function getSpikes(agentId: string, limit = 40): Promise<RejectionDoc[]> {
  return (await rejections())
    .find({ agentId }, { sort: { createdAt: -1 }, limit, projection: { _id: 0 } })
    .toArray();
}

export async function getRuns(agentId: string, limit = 24): Promise<RunDoc[]> {
  return (await runs())
    .find({ agentId }, { sort: { startedAt: -1 }, limit, projection: { _id: 0 } })
    .toArray();
}

/**
 * The demo agent the front page embeds.
 *
 * Prefers an explicitly flagged agent, then an env-pinned id, and otherwise
 * falls back to the oldest agent on the system. The fallback matters: the front
 * page must never render empty just because a deployment forgot a variable.
 */
export async function getDemoAgent(): Promise<AgentDoc | null> {
  const col = await agents();

  const flagged = await col.findOne({ isDemo: true }, { projection: { _id: 0 } });
  if (flagged) return flagged;

  const pinned = process.env.TAAR_DEMO_AGENT_ID;
  if (pinned) {
    const found = await col.findOne({ agentId: pinned }, { projection: { _id: 0 } });
    if (found) return found;
  }

  return col.findOne({}, { projection: { _id: 0 }, sort: { createdAt: 1 } });
}

export type WireStatus = {
  lastTickAt: string | null;
  lastTickOutcome: RunDoc["outcome"] | null;
  lastPostAt: string | null;
  dispatchCount: number;
  spikeCount: number;
  tickCount: number;
};

/** Live status for the wire strip. Read from Mongo — never hardcoded. */
export async function getWireStatus(agentId: string): Promise<WireStatus> {
  const [runCol, postCol, spikeCol] = await Promise.all([runs(), posts(), rejections()]);

  const [lastRun, lastPost, dispatchCount, spikeCount, tickCount] = await Promise.all([
    runCol.find({ agentId }, { sort: { startedAt: -1 }, limit: 1 }).next(),
    postCol.find({ agentId }, { sort: { createdAt: -1 }, limit: 1 }).next(),
    postCol.countDocuments({ agentId }),
    spikeCol.countDocuments({ agentId }),
    runCol.countDocuments({ agentId }),
  ]);

  return {
    lastTickAt: lastRun?.startedAt ?? null,
    lastTickOutcome: lastRun?.outcome ?? null,
    lastPostAt: lastPost?.createdAt ?? null,
    dispatchCount,
    spikeCount,
    tickCount,
  };
}
