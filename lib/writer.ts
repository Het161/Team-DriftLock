import { generateJson, type Provider } from "./llm";
import type { Charter } from "./schema";
import type { Candidate } from "./discovery";
import { formatMemory, type RecalledFact } from "./breeth";

/**
 * Drafting a dispatch.
 *
 * The one rule with no exceptions: `sources` may only contain URLs that
 * discovery actually returned. Models will happily invent a plausible-looking
 * link, and a fabricated source is the single failure a judge is most certain
 * to catch. So the model's list is intersected against the real candidate URLs
 * after the fact — the prompt asks for good behaviour, the filter guarantees it.
 */

export type Dispatch = {
  text: string;
  rationale: string;
  sources: string[];
  wordCount: number;
};

const SYSTEM = `You are a wire correspondent filing a dispatch under your own name. You have already decided this story runs. Now write it.

The dispatch:
- 120 to 220 words. This is a considered take, not a summary and not an essay.
- Lead with your judgement, not with "According to reports". The reader can get the facts elsewhere; they come to you for what it means.
- Take the position your charter commits you to. Be specific enough to be wrong.
- Name the concrete details — numbers, companies, mechanisms — that justify the take.
- No headline. No byline. No markdown. No bullet points. Prose only.
- Never invent a fact, a number, a quote, or a URL.

About referring to your own past work — this matters and is easy to get wrong:
- Your standing positions are what you believe. You may assert them freely, in
  the present tense, as convictions.
- A claim about your own publishing history — "as I argued last week", "a stance
  I have consistently maintained", "when I covered this earlier" — is a factual
  claim about the past. Make it ONLY if it appears under DISPATCHES YOU HAVE
  ALREADY FILED below, and refer to what you said, not merely that you said it.
- If that section says you have filed nothing, then you have filed nothing.
  Write this as what it is: a first look. Do not manufacture a history.

The rationale is written for an editor reviewing your judgement, not for the reader. It must cover three things explicitly:
  1. why you selected this story,
  2. why it is worth running now rather than later,
  3. how it compared to the rest of the desk.

On point 3, be literal about what was actually in front of you. If other
candidates are listed below, name them and say why this one won. If the desk
says nothing else cleared consideration, then there was nothing to beat — say
that plainly. Claiming to have "beaten other candidates" on a desk of one is a
false statement about your own process, and the rationale is the part a reader
trusts you on.

Return a single JSON object:
{
  "text": "the dispatch",
  "rationale": "the three-part justification",
  "sources": ["only URLs given to you below"]
}`;

export async function draft(input: {
  persona: { name: string; domain: string };
  charter: Charter;
  winner: Candidate;
  /** The candidates it beat, for the rationale to name. */
  beatOut: Candidate[];
  memory: RecalledFact[];
  /** Read from Mongo, not memory — the only licence for a continuity callback. */
  priorDispatches: Array<{ title: string; when: string; gist: string }>;
  editorJustification: string;
  prefer?: Provider;
}): Promise<{ dispatch: Dispatch; provider: Provider }> {
  const memory = formatMemory(input.memory);

  // The only URLs allowed to appear in the finished dispatch.
  const allowed = [input.winner.url, ...input.beatOut.map((c) => c.url)].filter(Boolean);

  const prompt = [
    `You are ${input.persona.name}, covering ${input.persona.domain}.`,
    "",
    "YOUR VOICE",
    input.charter.voice,
    "",
    "YOUR STANDING POSITIONS",
    ...input.charter.opinions.map((o) => `- ${o}`),
    "",
    "THE STORY YOU ARE RUNNING",
    `Headline: ${input.winner.title}`,
    `Source: ${input.winner.sourceLabel}`,
    `URL: ${input.winner.url}`,
    `Published: ${input.winner.publishedAt}`,
    input.winner.snippet ? `Excerpt: ${input.winner.snippet}` : "Excerpt: (none available)",
    "",
    input.beatOut.length
      ? `WHAT IT BEAT (name these in the rationale)\n${input.beatOut
          .map((c) => `- "${c.title}" (${c.sourceLabel}) — ${c.url}`)
          .join("\n")}`
      : "WHAT IT BEAT\nNothing — this was the only candidate on the desk this cycle. Do NOT write that it beat other candidates or was chosen over anything; say instead that it was the only story that reached you worth considering.",
    "",
    input.editorJustification
      ? `YOUR OWN NOTE WHEN YOU PICKED IT\n${input.editorJustification}`
      : "",
    "",
    input.priorDispatches.length
      ? `DISPATCHES YOU HAVE ALREADY FILED (the only past work you may refer to; build on it where genuinely relevant, do not force a callback)\n${input.priorDispatches
          .map((d) => `- ${d.when} — "${d.title}": ${d.gist}`)
          .join("\n")}`
      : "DISPATCHES YOU HAVE ALREADY FILED\nNone. This is your first dispatch. You have never published on this or any other story, so do not claim or imply that you have — no 'as I have argued', no 'consistently', no callbacks of any kind.",
    "",
    memory
      ? `POSITIONS AND CONTEXT YOU HOLD (beliefs, not published work — assert them, but never as things you previously wrote)\n${memory}`
      : "",
    "",
    "URLS YOU MAY CITE (you may not cite any other URL, and you may not modify these)",
    ...allowed.map((u) => `- ${u}`),
    "",
    "File the dispatch.",
  ]
    .filter(Boolean)
    .join("\n");

  const { value, provider } = await generateJson<RawDispatch>(
    {
      label: "dispatch",
      system: SYSTEM,
      prompt,
      temperature: 0.75,
      maxTokens: 1400,
      timeoutMs: 30_000,
      prefer: input.prefer,
    },
    isRawDispatch,
  );

  return {
    dispatch: finalise(value, input.winner, allowed),
    provider,
  };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

type RawDispatch = { text: string; rationale: string; sources?: unknown };

function isRawDispatch(v: unknown): v is RawDispatch {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  if (typeof d.text !== "string" || typeof d.rationale !== "string") return false;

  // Enforced here rather than after the fact, so a thin draft costs a retry
  // inside generateJson instead of becoming a published stub.
  const words = countWords(d.text);
  return words >= 90 && words <= 320 && d.rationale.trim().length >= 60;
}

function finalise(raw: RawDispatch, winner: Candidate, allowed: string[]): Dispatch {
  const permitted = new Set(allowed);

  const cited = Array.isArray(raw.sources)
    ? raw.sources.filter((s): s is string => typeof s === "string" && permitted.has(s))
    : [];

  // The story being written about is always a source, whether or not the model
  // remembered to list it, and it always leads.
  const sources = [...new Set([winner.url, ...cited])];

  const text = raw.text.trim().replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n");

  return {
    text,
    rationale: raw.rationale.trim(),
    sources,
    wordCount: countWords(text),
  };
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}
