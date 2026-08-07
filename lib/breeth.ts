/**
 * Breeth — the editor's long-term memory.
 *
 * Breeth is a knowledge graph (Graphiti underneath), not a document store. That
 * has one consequence which dictates this whole file: it extracts entities and
 * relationships from prose, so an episode written as a terse fragment produces
 * zero edges and is effectively unrecallable. Probing it during the build,
 * "TAAR connectivity probe: the editor is being wired up" yielded 1 entity and
 * 0 edges, while the same information written as full sentences with the
 * persona as a named subject yielded 8 entities and 6 edges.
 *
 * So `remember()` takes structured facts and renders them into subject-verb
 * sentences that name the agent explicitly. Never write pronouns here.
 *
 * Every function in this module fails open. Breeth being down must never stop
 * TAAR publishing — Mongo dedupe is the safety net, and memory is an
 * enhancement to editorial continuity, not a precondition for it.
 */

const BASE = "https://api.thebreeth.com/v1";
const TIMEOUT_MS = 10_000;

export type RecalledFact = {
  /** A natural-language statement, e.g. "Kaveri criticized vendor benchmarks…" */
  fact: string;
  /** Graphiti's classification: "action", "principle", "preference", … */
  kind: string | null;
  /** Why Breeth thinks this is relevant to the query. */
  why: string | null;
};

export function breethConfigured(): boolean {
  return Boolean(process.env.BREETH_API_KEY);
}

/* -------------------------------------------------------------------------- */
/* Write                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Records what the agent did and what it argued, as prose Graphiti can mine.
 *
 * `sentences` should each name the agent and state one thing:
 *   "Kaveri argued that inference pricing collapses faster than training."
 */
export async function remember(
  agentId: string,
  agentName: string,
  sentences: string[],
): Promise<{ ok: boolean; entities: number; edges: number; error?: string }> {
  if (!breethConfigured()) return { ok: false, entities: 0, edges: 0, error: "no api key" };

  const content = sentences
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith(agentName) ? s : `${agentName} ${s}`))
    .map((s) => (/[.!?]$/.test(s) ? s : `${s}.`))
    .join(" ");

  if (!content) return { ok: false, entities: 0, edges: 0, error: "nothing to record" };

  try {
    const res = await fetch(`${BASE}/episodes`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.BREETH_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content, group_id: agentId, extract_intent: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      return {
        ok: false,
        entities: 0,
        edges: 0,
        error: `HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 120)}`,
      };
    }

    const body = (await res.json()) as {
      extracted?: { entities?: number; edges?: number };
    };
    return {
      ok: true,
      entities: body.extracted?.entities ?? 0,
      edges: body.extracted?.edges ?? 0,
    };
  } catch (err) {
    return {
      ok: false,
      entities: 0,
      edges: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Read                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Asks memory what this agent already thinks about a topic.
 *
 * Scoped by group_id so the demo agent and the evaluator's agent never see each
 * other's history. Returns [] on any failure, by design.
 */
export async function recall(
  agentId: string,
  query: string,
  limit = 8,
): Promise<RecalledFact[]> {
  if (!breethConfigured()) return [];

  try {
    const res = await fetch(`${BASE}/search`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.BREETH_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, limit, group_id: agentId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) return [];

    const body = (await res.json()) as {
      edges?: Array<{
        fact?: string;
        intent_meta?: { edge_kind?: string; why_connected?: string } | null;
      }>;
    };

    return (body.edges ?? [])
      .filter((e) => typeof e.fact === "string" && e.fact.trim())
      .map((e) => ({
        fact: e.fact!.trim(),
        kind: e.intent_meta?.edge_kind ?? null,
        why: e.intent_meta?.why_connected ?? null,
      }));
  } catch {
    return [];
  }
}

/** Renders recalled facts for an LLM prompt. Empty string when memory is empty. */
export function formatMemory(facts: RecalledFact[]): string {
  if (!facts.length) return "";
  return facts
    .map((f) => `- ${f.fact}${f.kind ? ` [${f.kind}]` : ""}`)
    .join("\n");
}
