import type { Collection } from "mongodb";
import { getDb } from "./db";

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The Editorial Charter: the persona-agnostic core of TAAR.
 *
 * The evaluator picks the persona, so nothing here may be hardcoded to one
 * identity. Init expands {name, domain} into this structure with a single LLM
 * call, and every later decision — what to cover, what to spike, how to write —
 * is read back out of it. Persona consistency is a consequence of the charter
 * being written once and obeyed forever, not of prompt repetition.
 */
export type Charter = {
  /** 3–4 sentences: tone, sentence rhythm, signature verbal habits. */
  voice: string;
  /** 4–6 sub-topics inside the domain this persona actually covers. */
  beats: string[];
  /** 3–5 standing editorial positions. Specific and arguable, not platitudes. */
  opinions: string[];
  /** The publishing bar, with named thresholds. */
  standards: {
    publish: string;
    spike: string;
    thresholds: {
      novelty: string;
      substance: string;
      relevance: string;
      hypeResistance: string;
    };
  };
  /** 6–10 search queries derived from the domain, fed to the source adapters. */
  sourcePlan: string[];
  cadence: {
    /** Target dispatches per day, 3–5. */
    postsPerDay: number;
    /** Minimum minutes between dispatches, >= 90. */
    minGapMinutes: number;
  };
};

export type AgentDoc = {
  agentId: string;
  persona: { name: string; domain: string };
  charter: Charter | null;
  /**
   * `pending` means init's LLM call timed out or failed and the first tick must
   * build the charter before it can publish. Init never 500s over a model hiccup.
   */
  charterStatus: "ready" | "pending" | "failed";
  status: "active" | "paused";
  /** Marks our own demo agent so the UI can find it without hardcoding an id. */
  isDemo?: boolean;
  /**
   * What memory returned on the most recent cycle.
   *
   * Written by the tick rather than queried when the newsroom renders. Two
   * reasons: a page render should not hang on a third-party API that is allowed
   * to be slow, and more importantly this is the recall that actually informed
   * the last editorial decision — which is a truer answer to "what does the
   * editor remember" than a fresh query with a different phrasing would be.
   */
  memorySnapshot?: {
    facts: Array<{ fact: string; kind: string | null; why: string | null }>;
    at: string;
    query: string;
  };
  createdAt: string;
  updatedAt: string;
  lastPostAt: string | null;
  postCount: number;
};

/**
 * A published dispatch.
 *
 * The first five fields are the public contract and are the ONLY ones the feed
 * route is allowed to emit. Everything below them exists for our own newsroom UI
 * and reaches the browser through /api/internal/agent/[id], never through
 * /api/agent/feed.
 */
export type PostDoc = {
  id: string;
  createdAt: string;
  text: string;
  rationale: string;
  sources: string[];

  agentId: string;
  runId: string;
  candidate: { title: string; url: string; source: string } | null;
  /** Titles of the candidates this dispatch beat, for the newsroom UI. */
  beatOut: string[];
  memoryUsed: boolean;
  provider: string | null;
  wordCount: number;
};

/** A story the editor considered and refused. The spike log is a judged artifact. */
export type RejectionDoc = {
  id: string;
  agentId: string;
  runId: string;
  createdAt: string;
  title: string;
  url: string;
  source: string;
  verdict: "spike" | "hold";
  /** 0–100 against the charter's standards. */
  score: number;
  reason: string;
};

/** One tick, whether or not it published. Rendered as the live wire log. */
export type RunDoc = {
  runId: string;
  agentId: string | null;
  trigger: "actions" | "http" | "manual";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  outcome: "published" | "quiet" | "skipped" | "locked" | "error";
  candidatesFound: number;
  candidatesAfterDedupe: number;
  spiked: number;
  published: number;
  llmCalls: number;
  provider: string | null;
  notes: string[];
  error: string | null;
};

/** Lease held for the duration of a tick. TTL-indexed so a crash self-heals. */
export type LockDoc = {
  _id: string;
  holder: string;
  acquiredAt: Date;
  expiresAt: Date;
};

/* -------------------------------------------------------------------------- */
/* Collections                                                                 */
/* -------------------------------------------------------------------------- */

export async function agents(): Promise<Collection<AgentDoc>> {
  return (await getDb()).collection<AgentDoc>("agents");
}
export async function posts(): Promise<Collection<PostDoc>> {
  return (await getDb()).collection<PostDoc>("posts");
}
export async function rejections(): Promise<Collection<RejectionDoc>> {
  return (await getDb()).collection<RejectionDoc>("rejections");
}
export async function runs(): Promise<Collection<RunDoc>> {
  return (await getDb()).collection<RunDoc>("runs");
}
export async function locks(): Promise<Collection<LockDoc>> {
  return (await getDb()).collection<LockDoc>("locks");
}

/* -------------------------------------------------------------------------- */
/* Indexes                                                                     */
/* -------------------------------------------------------------------------- */

let indexesReady: Promise<void> | undefined;

/**
 * Idempotent, and memoised per process so it costs one round trip per cold
 * start rather than one per request. Safe to call from any entrypoint.
 */
export function ensureIndexes(): Promise<void> {
  if (!indexesReady) {
    indexesReady = build().catch((err) => {
      indexesReady = undefined;
      throw err;
    });
  }
  return indexesReady;
}

async function build(): Promise<void> {
  const [a, p, r, ru, l] = await Promise.all([
    agents(),
    posts(),
    rejections(),
    runs(),
    locks(),
  ]);

  await Promise.all([
    a.createIndex({ agentId: 1 }, { unique: true, name: "agentId_unique" }),
    a.createIndex({ status: 1 }, { name: "status" }),

    // The feed's only query: newest-first within one agent.
    p.createIndex({ agentId: 1, createdAt: -1 }, { name: "agent_recent" }),
    // Stable, unique post ids are a contract requirement, enforced at the store.
    p.createIndex({ id: 1 }, { unique: true, name: "post_id_unique" }),
    // Dedupe lookup: has this agent already filed on this URL?
    p.createIndex({ agentId: 1, "candidate.url": 1 }, { name: "agent_source_url" }),

    r.createIndex({ agentId: 1, createdAt: -1 }, { name: "agent_recent" }),
    r.createIndex({ agentId: 1, url: 1 }, { name: "agent_url" }),

    ru.createIndex({ startedAt: -1 }, { name: "recent" }),
    ru.createIndex({ agentId: 1, startedAt: -1 }, { name: "agent_recent" }),

    // A tick that dies mid-run leaves its lease behind; Mongo reaps it.
    l.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "lease_ttl" }),
  ]);
}
