import { randomUUID } from "node:crypto";
import {
  agents,
  posts,
  rejections,
  runs,
  ensureIndexes,
  type AgentDoc,
  type PostDoc,
  type RejectionDoc,
  type RunDoc,
} from "./schema";
import { acquireLease, releaseLease } from "./lock";
import { discover, normaliseTitle, normaliseUrl, type Candidate } from "./discovery";
import { buildCharter } from "./charter";
import { decideCadence, dayKey } from "./cadence";
import { judge } from "./editor";
import { draft } from "./writer";
import { recall, remember } from "./breeth";
import { llmCallsUsed, llmTokensUsed, resetLlmCalls, type Provider } from "./llm";

/**
 * One editorial cycle.
 *
 * Invoked from two places on purpose — a GitHub Actions cron every 30 minutes,
 * and POST /api/agent/tick for an external pinger — because the likeliest way
 * this project dies during a 48-hour evaluation is a single free scheduler
 * quietly stopping. The Mongo lease in lib/lock.ts is what makes that
 * redundancy safe.
 */

/** Ceiling per cycle, per the free-tier budget. */
const MAX_LLM_CALLS_PER_TICK = 8;
/**
 * Beyond this many tokens today, prefer the fallback provider.
 *
 * Groq's free tier caps llama-3.3-70b at 100,000 tokens per day. That limit is
 * invisible in the response headers — the request counter read 998/1000 while
 * the account was at 96.7k tokens and about to start failing. 80k leaves room
 * for the cycle in flight to finish on Groq rather than dying mid-dispatch.
 */
const DAILY_GROQ_TOKEN_LIMIT = 80_000;
/** Agents handled in one cycle. Anything beyond waits for the next. */
const MAX_AGENTS_PER_TICK = 3;
/** Candidates the editorial gate actually reads. Each one costs prompt tokens. */
const DESK_SIZE = 6;
/**
 * On a cycle that cannot publish anyway, judge at most this often.
 *
 * Running the gate every cycle was the right instinct — editorial life
 * continues, and the spike log is a judged artifact — but at six cycles an hour
 * across multiple agents it is also where the entire daily token budget goes.
 * The wire still spikes steadily; it just does not re-judge the same desk four
 * times an hour to prove it.
 */
const QUIET_JUDGE_INTERVAL_MS = 60 * 60 * 1000;
/** Below this many fresh candidates, widen the search before giving up. */
const MIN_DESK = 4;
/** How long a held story stays off the desk before it may be reconsidered. */
const HOLD_COOLDOWN_MS = 3 * 60 * 60 * 1000;

export type AgentRunSummary = {
  agentId: string;
  persona: string;
  outcome: RunDoc["outcome"];
  candidatesFound: number;
  candidatesAfterDedupe: number;
  spiked: number;
  published: number;
  postId: string | null;
  notes: string[];
  error: string | null;
  durationMs: number;
};

export type TickReport = {
  locked: boolean;
  durationMs: number;
  agentsConsidered: number;
  llmCalls: number;
  preferredProvider: Provider;
  summaries: AgentRunSummary[];
};

export async function runTick(options: {
  trigger: RunDoc["trigger"];
  /** Stop starting new agents after this timestamp. Protects the HTTP path. */
  deadline?: number;
}): Promise<TickReport> {
  const startedAt = Date.now();
  resetLlmCalls();

  await ensureIndexes();

  const lease = await acquireLease();
  if (!lease) {
    // Another scheduler is mid-cycle. Exiting silently is the whole point.
    return {
      locked: true,
      durationMs: Date.now() - startedAt,
      agentsConsidered: 0,
      llmCalls: 0,
      preferredProvider: "groq",
      summaries: [],
    };
  }

  try {
    const preferredProvider = await pickProvider();

    const roster = await (await agents())
      .find({ status: "active" })
      // Least-recently-PROCESSED first — not least-recently-published. Mongo
      // sorts null before dates, so a never-yet-processed agent (the
      // evaluator's, moments after init) is served first, and every agent then
      // rotates fairly regardless of whether it manages to publish. Ordering by
      // lastPostAt instead would let an agent that never files sit permanently
      // at the front of the queue and lock out the ones that do.
      .sort({ lastRunAt: 1, createdAt: 1 })
      .limit(MAX_AGENTS_PER_TICK)
      .toArray();

    const summaries: AgentRunSummary[] = [];

    for (const agent of roster) {
      if (llmCallsUsed() >= MAX_LLM_CALLS_PER_TICK) {
        summaries.push(
          skipped(agent, "Cycle LLM budget spent; this agent runs next cycle."),
        );
        continue;
      }
      if (options.deadline && Date.now() > options.deadline) {
        summaries.push(skipped(agent, "Cycle deadline reached before this agent started."));
        continue;
      }

      // One agent failing must never starve the others.
      try {
        summaries.push(await tickAgent(agent, options.trigger, preferredProvider));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // Stamp it even on failure. An agent that throws every cycle would
        // otherwise keep a null lastRunAt and permanently hold first place in
        // the roster, which is the exact starvation this ordering prevents.
        await (await agents())
          .updateOne(
            { agentId: agent.agentId },
            { $set: { lastRunAt: new Date().toISOString() } },
          )
          .catch(() => {});

        summaries.push({
          agentId: agent.agentId,
          persona: agent.persona.name,
          outcome: "error",
          candidatesFound: 0,
          candidatesAfterDedupe: 0,
          spiked: 0,
          published: 0,
          postId: null,
          notes: [],
          error: message,
          durationMs: 0,
        });
        await recordRun({
          runId: randomUUID(),
          agentId: agent.agentId,
          trigger: options.trigger,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0,
          outcome: "error",
          candidatesFound: 0,
          candidatesAfterDedupe: 0,
          spiked: 0,
          published: 0,
          llmCalls: llmCallsUsed(),
          tokens: llmTokensUsed(),
          provider: null,
          notes: [],
          error: message,
        });
      }
    }

    return {
      locked: false,
      durationMs: Date.now() - startedAt,
      agentsConsidered: roster.length,
      llmCalls: llmCallsUsed(),
      preferredProvider,
      summaries,
    };
  } finally {
    await releaseLease(lease);
  }
}

/* -------------------------------------------------------------------------- */
/* One agent                                                                   */
/* -------------------------------------------------------------------------- */

async function tickAgent(
  agent: AgentDoc,
  trigger: RunDoc["trigger"],
  prefer: Provider,
): Promise<AgentRunSummary> {
  const runId = randomUUID();
  const startedAt = new Date();
  const notes: string[] = [];
  let provider: Provider | null = null;

  /* 1 — the charter, without which nothing else has a standard to meet. */
  let charter = agent.charter;
  if (!charter || agent.charterStatus !== "ready") {
    const built = await buildCharter(agent.persona, prefer);
    charter = built.charter;
    provider = built.provider;
    notes.push(`Charter built via ${built.provider}.`);

    await (await agents()).updateOne(
      { agentId: agent.agentId },
      {
        $set: {
          charter,
          charterStatus: "ready",
          updatedAt: new Date().toISOString(),
        },
      },
    );

    await remember(agent.agentId, agent.persona.name, [
      `covers ${agent.persona.domain} for the TAAR wire.`,
      `works these beats: ${charter.beats.join(", ")}.`,
      ...charter.opinions.map((o) => `holds this position: ${o}`),
    ]);
  }

  /* 2 — may we publish this cycle? */
  const postsToday = await countPostsToday(agent.agentId, startedAt);
  const cadence = decideCadence({
    charter,
    lastPostAt: agent.lastPostAt,
    postsToday,
    agentId: agent.agentId,
    now: startedAt,
  });
  notes.push(cadence.reason);

  /* 3 — discovery runs even on quiet cycles: editorial life continues. */
  //
  // The query pool is the sourcePlan AND the beats, deduped. Overnight the wire
  // went silent for nine hours: discovery kept returning 30+ candidates and
  // dedupe eliminated every one, because six sourcePlan queries had already
  // surfaced and spiked everything they could reach. Rejections are permanent,
  // so a fixed query set means the reachable pool only ever shrinks. The beats
  // roughly double the vocabulary and are on-topic by construction — they came
  // from the same charter — which an untargeted front-page pull would not be.
  const queryPool = [...charter.sourcePlan, ...charter.beats];

  const discovery = await discover(queryPool);
  for (const a of discovery.adapters) {
    if (!a.ok) notes.push(`${a.source} unavailable: ${a.error}`);
  }

  /* 4 — drop anything already published or already refused. */
  let fresh = await dedupe(agent.agentId, discovery.candidates);
  let totalFound = discovery.candidates.length;

  // A narrow beat can come back with almost nothing — a niche persona's queries
  // simply do not produce a story every thirty minutes, and after dedupe the
  // desk is empty. Since the evaluator chooses the domain and may well choose a
  // narrow one, one widening pass over a different slice of the sourcePlan runs
  // before giving up. It costs HTTP requests, not LLM calls.
  if (fresh.length < MIN_DESK) {
    const wider = await discover(queryPool, {
      offset: Math.ceil(queryPool.length / 2),
    });
    totalFound += wider.candidates.length;

    const seen = new Set(fresh.map((c) => normaliseUrl(c.url)));
    const extra = (await dedupe(agent.agentId, wider.candidates)).filter(
      (c) => !seen.has(normaliseUrl(c.url)),
    );

    if (extra.length) {
      fresh = [...fresh, ...extra];
      notes.push(`Desk was thin; widened the search and found ${extra.length} more.`);
    }
  }

  if (!fresh.length) {
    return finish({
      runId,
      agent,
      trigger,
      startedAt,
      outcome: "quiet",
      candidatesFound: totalFound,
      candidatesAfterDedupe: 0,
      spiked: 0,
      published: 0,
      postId: null,
      provider,
      notes: [...notes, "Nothing new on the desk."],
    });
  }

  /* 5 — what does the editor already think, and what has it actually filed? */
  const desk = fresh.slice(0, DESK_SIZE);

  const memoryQuery = `${agent.persona.domain}: ${desk.map((c) => c.title).join("; ")}`;

  const [memory, priorDispatches] = await Promise.all([
    recall(agent.agentId, memoryQuery, 8),
    recentDispatches(agent.agentId, 6),
  ]);

  if (memory.length) {
    notes.push(`Recalled ${memory.length} stance(s) from memory.`);
    // Persisted so the newsroom can show what actually informed this decision
    // without making a live Breeth call while rendering a page.
    await (await agents()).updateOne(
      { agentId: agent.agentId },
      {
        $set: {
          memorySnapshot: {
            facts: memory,
            at: new Date().toISOString(),
            query: memoryQuery.slice(0, 300),
          },
        },
      },
    );
  }

  /* 6 — the editorial gate, budget permitting. */
  //
  // Skipped only when we could not publish this cycle anyway AND the desk was
  // judged recently. When the window is open the gate always runs: that is the
  // cycle that can actually file, and it must never be the one we economised on.
  const lastJudged = agent.lastJudgedAt ? new Date(agent.lastJudgedAt).getTime() : 0;
  const judgedRecently = Date.now() - lastJudged < QUIET_JUDGE_INTERVAL_MS;

  if (!cadence.mayPublish && judgedRecently) {
    return finish({
      runId,
      agent,
      trigger,
      startedAt,
      outcome: "quiet",
      candidatesFound: totalFound,
      candidatesAfterDedupe: fresh.length,
      spiked: 0,
      published: 0,
      postId: null,
      provider,
      notes: [...notes, `Outside the window and judged recently; saving the budget.`],
    });
  }

  //
  // A drought is only reported when the wire is actually open and behind: the
  // gate has already said we may publish, it has been hours, and the day's
  // target is unmet. In normal operation this is null and the editor never
  // hears about timing at all.
  // The idle clock runs from the last dispatch, or from creation for an agent
  // that has never filed. Keying it on lastPostAt alone meant a brand-new agent
  // could never be in drought at all — the nudge skipped precisely the agent
  // that most needs to publish, the evaluator's, minutes after they created it.
  //
  // A new agent also gets a far shorter fuse. Four hours of silence is a lull
  // for an established wire; on a feed the evaluator just opened it is the
  // entire first impression.
  const DROUGHT_AFTER_MIN = 240;
  const NEW_AGENT_DROUGHT_AFTER_MIN = 25;

  const neverFiled = agent.lastPostAt === null;
  const idleSince = agent.lastPostAt ?? agent.createdAt;
  const minutesIdle = (startedAt.getTime() - new Date(idleSince).getTime()) / 60_000;
  const droughtAfter = neverFiled ? NEW_AGENT_DROUGHT_AFTER_MIN : DROUGHT_AFTER_MIN;

  const drought =
    cadence.mayPublish &&
    Number.isFinite(minutesIdle) &&
    minutesIdle >= droughtAfter &&
    postsToday < charter.cadence.postsPerDay
      ? {
          minutes: Math.round(minutesIdle),
          neverFiled,
          postsToday,
          target: charter.cadence.postsPerDay,
        }
      : null;

  if (drought) {
    notes.push(
      drought.neverFiled
        ? `Drought: nothing filed yet, ${drought.minutes} min since initialization.`
        : `Drought: ${Math.floor(drought.minutes / 60)}h idle, ${drought.postsToday}/${drought.target} filed today.`,
    );
  }

  const { decision, provider: judgeProvider } = await judge({
    persona: agent.persona,
    charter,
    candidates: desk,
    memory,
    priorDispatches,
    drought,
    prefer,
  });
  provider = judgeProvider;

  await (await agents()).updateOne(
    { agentId: agent.agentId },
    { $set: { lastJudgedAt: new Date().toISOString() } },
  );

  /* 7 — every refusal is recorded, published or not. */
  const refused = decision.verdicts.filter(
    (v) => v.verdict !== "publish" || v.index !== decision.winnerIndex,
  );
  await persistRejections(agent.agentId, runId, desk, refused);

  const winner = decision.winnerIndex === null ? null : desk[decision.winnerIndex];

  if (!winner) {
    return finish({
      runId,
      agent,
      trigger,
      startedAt,
      outcome: "quiet",
      candidatesFound: totalFound,
      candidatesAfterDedupe: fresh.length,
      spiked: refused.length,
      published: 0,
      postId: null,
      provider,
      notes: [...notes, "Nothing cleared the bar. Spiked the desk."],
    });
  }

  if (!cadence.mayPublish) {
    return finish({
      runId,
      agent,
      trigger,
      startedAt,
      outcome: "quiet",
      candidatesFound: totalFound,
      candidatesAfterDedupe: fresh.length,
      spiked: refused.length,
      published: 0,
      postId: null,
      provider,
      notes: [...notes, `Held "${winner.title}" — outside the filing window.`],
    });
  }

  if (llmCallsUsed() >= MAX_LLM_CALLS_PER_TICK) {
    return finish({
      runId,
      agent,
      trigger,
      startedAt,
      outcome: "skipped",
      candidatesFound: totalFound,
      candidatesAfterDedupe: fresh.length,
      spiked: refused.length,
      published: 0,
      postId: null,
      provider,
      notes: [...notes, "LLM budget spent before drafting."],
    });
  }

  /* 8 — write it. */
  const beatOut = desk.filter((_, i) => i !== decision.winnerIndex).slice(0, 5);
  const { dispatch, provider: writeProvider } = await draft({
    persona: agent.persona,
    charter,
    winner,
    beatOut,
    memory,
    priorDispatches,
    editorJustification: decision.winnerJustification,
    prefer,
  });
  provider = writeProvider;

  const createdAt = new Date().toISOString();
  const post: PostDoc = {
    id: randomUUID(),
    createdAt,
    text: dispatch.text,
    rationale: dispatch.rationale,
    sources: dispatch.sources,
    agentId: agent.agentId,
    runId,
    candidate: {
      title: winner.title,
      url: winner.url,
      source: winner.sourceLabel,
    },
    beatOut: beatOut.map((c) => c.title),
    memoryUsed: memory.length > 0,
    provider: writeProvider,
    wordCount: dispatch.wordCount,
  };

  await (await posts()).insertOne(post);
  await (await agents()).updateOne(
    { agentId: agent.agentId },
    { $set: { lastPostAt: createdAt, updatedAt: createdAt }, $inc: { postCount: 1 } },
  );

  /* 9 — remember the stance, in prose Graphiti can actually mine. */
  const memoryWrite = await remember(agent.agentId, agent.persona.name, [
    `published a dispatch about "${winner.title}" on ${createdAt.slice(0, 10)}.`,
    `sourced that dispatch from ${winner.sourceLabel}.`,
    `argued the following: ${firstSentences(dispatch.text, 2)}`,
    beatOut.length
      ? `chose that story over "${beatOut[0].title}".`
      : `found no competing story worth naming.`,
  ]);
  if (!memoryWrite.ok) notes.push(`Memory write failed: ${memoryWrite.error}`);
  else notes.push(`Memory updated: ${memoryWrite.entities} entities, ${memoryWrite.edges} edges.`);

  return finish({
    runId,
    agent,
    trigger,
    startedAt,
    outcome: "published",
    candidatesFound: totalFound,
    candidatesAfterDedupe: fresh.length,
    spiked: refused.length,
    published: 1,
    postId: post.id,
    provider,
    notes: [...notes, `Filed "${winner.title}" (${dispatch.wordCount} words).`],
  });
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Drops candidates this agent has already published or spiked.
 *
 * Matches on both normalised URL and normalised title, because the same story
 * reaches us from several adapters under slightly different headlines and with
 * different tracking parameters. This is also the safety net that lets Breeth
 * fail without risking a duplicate dispatch.
 *
 * Holds are treated differently from spikes — see the note inside.
 */
async function dedupe(agentId: string, candidates: Candidate[]): Promise<Candidate[]> {
  const [publishedDocs, refusedDocs] = await Promise.all([
    (await posts())
      .find({ agentId }, { projection: { _id: 0, candidate: 1 } })
      .toArray(),
    (await rejections())
      .find(
        { agentId },
        { projection: { _id: 0, url: 1, title: 1, verdict: 1, createdAt: 1 }, sort: { createdAt: 1 } },
      )
      .toArray(),
  ]);

  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();

  for (const p of publishedDocs) {
    if (p.candidate?.url) seenUrls.add(normaliseUrl(p.candidate.url));
    if (p.candidate?.title) seenTitles.add(normaliseTitle(p.candidate.title));
  }

  // Sorted oldest-first above, so the last write for a URL wins here — a story
  // held twice is governed by the most recent hold, not the first.
  const latestVerdict = new Map<string, { verdict: string; at: number }>();
  for (const r of refusedDocs) {
    if (!r.url) continue;
    latestVerdict.set(normaliseUrl(r.url), {
      verdict: r.verdict,
      at: new Date(r.createdAt).getTime(),
    });
    if (r.verdict === "spike" && r.title) seenTitles.add(normaliseTitle(r.title));
  }

  const now = Date.now();
  for (const [url, v] of latestVerdict) {
    if (v.verdict === "spike") {
      seenUrls.add(url);
      continue;
    }
    // A hold is not a refusal, it is a deferral — "real but not yet, needs
    // corroboration or a development". Treating it like a spike meant the one
    // verdict that exists to be revisited never was, and every near-miss was
    // burned permanently. That is how the wire talked itself into a nine-hour
    // silence: at six cycles an hour it consumed its own candidate pool, and
    // overnight nothing replenished it. Holds come back after a cooling-off
    // period; genuine spikes never do.
    if (now - v.at < HOLD_COOLDOWN_MS) seenUrls.add(url);
  }

  return candidates.filter(
    (c) => !seenUrls.has(normaliseUrl(c.url)) && !seenTitles.has(normaliseTitle(c.title)),
  );
}

async function persistRejections(
  agentId: string,
  runId: string,
  desk: Candidate[],
  refused: Array<{ index: number; verdict: string; score: number; reason: string }>,
): Promise<void> {
  if (!refused.length) return;

  const createdAt = new Date().toISOString();
  const docs = refused
    .map<RejectionDoc | null>((v) => {
      const c = desk[v.index];
      if (!c) return null;
      return {
        id: randomUUID(),
        agentId,
        runId,
        createdAt,
        title: c.title,
        url: c.url,
        source: c.sourceLabel,
        verdict: v.verdict === "hold" ? "hold" : "spike",
        score: v.score,
        reason: v.reason,
      };
    })
    .filter((d): d is RejectionDoc => d !== null);

  if (docs.length) await (await rejections()).insertMany(docs);
}

/**
 * What this agent has actually published, from Mongo.
 *
 * Deliberately not read from Breeth. Memory holds two different kinds of fact —
 * charter seeds ("Meridian holds this position: …") and dispatch records
 * ("Meridian published a dispatch about …") — and they are indistinguishable to
 * a prompt. A brand-new agent recalls eight stances from its own charter, which
 * reads exactly like a publishing history it does not have. That is how the
 * first live dispatch ended up claiming a position it had "consistently
 * maintained" on day one.
 *
 * So: Mongo is the authority on what was published, Breeth is the authority on
 * what is believed. Only the former may license a continuity callback.
 */
export type PriorDispatch = { title: string; when: string; gist: string };

async function recentDispatches(agentId: string, limit: number): Promise<PriorDispatch[]> {
  const docs = await (await posts())
    .find(
      { agentId },
      {
        sort: { createdAt: -1 },
        limit,
        projection: { _id: 0, createdAt: 1, text: 1, candidate: 1 },
      },
    )
    .toArray();

  return docs.map((d) => ({
    title: d.candidate?.title ?? "(untitled)",
    when: d.createdAt.slice(0, 10),
    gist: firstSentences(d.text, 1),
  }));
}

async function countPostsToday(agentId: string, now: Date): Promise<number> {
  const prefix = dayKey(now);
  return (await posts()).countDocuments({
    agentId,
    createdAt: { $regex: `^${prefix}` },
  });
}

/**
 * Chooses which provider to try first.
 *
 * Groq's free tier is roughly 1,000 requests a day. Rather than discovering the
 * ceiling by being rejected at hour 40 of a 48-hour evaluation, the day's usage
 * is read back out of the run log and the fallback takes over early.
 */
async function pickProvider(): Promise<Provider> {
  if (!process.env.GROQ_API_KEY) return "gemini";
  if (!process.env.GEMINI_API_KEY) return "groq";

  const since = `${dayKey(new Date())}T00:00:00.000Z`;
  const today = await (await runs())
    .aggregate<{ total: number }>([
      { $match: { startedAt: { $gte: since } } },
      { $group: { _id: null, total: { $sum: "$tokens" } } },
    ])
    .toArray();

  const used = today[0]?.total ?? 0;
  return used >= DAILY_GROQ_TOKEN_LIMIT ? "gemini" : "groq";
}

function firstSentences(text: string, count: number): string {
  return (
    text
      .split(/(?<=[.!?])\s+/)
      .slice(0, count)
      .join(" ")
      .trim() || text.slice(0, 240)
  );
}

function skipped(agent: AgentDoc, why: string): AgentRunSummary {
  return {
    agentId: agent.agentId,
    persona: agent.persona.name,
    outcome: "skipped",
    candidatesFound: 0,
    candidatesAfterDedupe: 0,
    spiked: 0,
    published: 0,
    postId: null,
    notes: [why],
    error: null,
    durationMs: 0,
  };
}

async function finish(input: {
  runId: string;
  agent: AgentDoc;
  trigger: RunDoc["trigger"];
  startedAt: Date;
  outcome: RunDoc["outcome"];
  candidatesFound: number;
  candidatesAfterDedupe: number;
  spiked: number;
  published: number;
  postId: string | null;
  provider: Provider | null;
  notes: string[];
}): Promise<AgentRunSummary> {
  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - input.startedAt.getTime();

  // Stamp the agent as processed regardless of outcome. A quiet cycle is still
  // a turn taken, so the next cycle moves on to whoever has waited longest.
  await (await agents()).updateOne(
    { agentId: input.agent.agentId },
    { $set: { lastRunAt: finishedAt.toISOString() } },
  );

  await recordRun({
    runId: input.runId,
    agentId: input.agent.agentId,
    trigger: input.trigger,
    startedAt: input.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    outcome: input.outcome,
    candidatesFound: input.candidatesFound,
    candidatesAfterDedupe: input.candidatesAfterDedupe,
    spiked: input.spiked,
    published: input.published,
    llmCalls: llmCallsUsed(),
    tokens: llmTokensUsed(),
    provider: input.provider,
    notes: input.notes,
    error: null,
  });

  return {
    agentId: input.agent.agentId,
    persona: input.agent.persona.name,
    outcome: input.outcome,
    candidatesFound: input.candidatesFound,
    candidatesAfterDedupe: input.candidatesAfterDedupe,
    spiked: input.spiked,
    published: input.published,
    postId: input.postId,
    notes: input.notes,
    error: null,
    durationMs,
  };
}

async function recordRun(doc: RunDoc): Promise<void> {
  await (await runs()).insertOne(doc);
}
