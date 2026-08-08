import { generateJson, type Provider } from "./llm";
import type { Charter } from "./schema";
import type { Candidate } from "./discovery";
import { formatMemory, type RecalledFact } from "./breeth";

/**
 * The editorial gate — one LLM call that judges everything on the desk.
 *
 * This is where "quality of editorial decision-making" is actually earned. Two
 * choices matter:
 *
 * 1. All candidates are judged in ONE call, comparatively. Scoring each story
 *    in isolation produces a pile of 70s with no ranking; asking which of these
 *    eight is worth the wire produces an argument, which is what the rationale
 *    needs to quote.
 *
 * 2. Spikes are the point, not the leftovers. Every refusal is persisted with
 *    its reason, because a wire that only shows what it published is
 *    indistinguishable from one with no judgement at all.
 */

export type Verdict = {
  index: number;
  verdict: "publish" | "spike" | "hold";
  score: number;
  reason: string;
};

export type EditorialDecision = {
  verdicts: Verdict[];
  /** Index into the candidate array, or null when nothing cleared the bar. */
  winnerIndex: number | null;
  /** Why the winner beat the others, naming them. Feeds the public rationale. */
  winnerJustification: string;
};

const SYSTEM = `You are the editor of a wire service, deciding what goes out under your own name.

You will be given your editorial charter and a list of candidate stories from the last two days. Judge them AGAINST EACH OTHER and against your standards, then pick at most one to run.

How to judge:
- Apply your own thresholds. They are strict on purpose. Most stories should fail.
- "spike" = will not run, and say plainly why. "hold" = real but not yet — needs corroboration or a development. "publish" = clears the bar today.
- A story you have already covered is a spike unless it genuinely advances.
- Press releases, funding announcements with no technical detail, listicles, and superlatives without evidence are spikes.
- Score 0-100 against your standards. Be willing to score low. A field of 40s is a legitimate outcome.
- You may select NO winner. Publishing nothing is a valid editorial decision and is better than filing something weak.

Return a single JSON object:
{
  "verdicts": [{"index": 0, "verdict": "publish|spike|hold", "score": 0-100, "reason": "one specific sentence"}],
  "winnerIndex": 0,
  "winnerJustification": "why this one runs and the others do not, naming the ones it beat"
}

Include a verdict for EVERY candidate index. Set winnerIndex to null if nothing clears the bar.`;

export async function judge(input: {
  persona: { name: string; domain: string };
  charter: Charter;
  candidates: Candidate[];
  memory: RecalledFact[];
  /** Actually-published dispatches, from Mongo. Concrete repetition check. */
  priorDispatches: Array<{ title: string; when: string; gist: string }>;
  /**
   * Set only when the wire has been open and silent for hours with the day's
   * target unmet. Facts, not permission to lower the bar — see the prompt.
   */
  drought: {
    minutes: number;
    neverFiled: boolean;
    postsToday: number;
    target: number;
  } | null;
  prefer?: Provider;
}): Promise<{ decision: EditorialDecision; provider: Provider }> {
  const { candidates } = input;
  if (!candidates.length) {
    throw new Error("judge() called with no candidates");
  }

  const memory = formatMemory(input.memory);

  const prompt = [
    `You are ${input.persona.name}, covering ${input.persona.domain}.`,
    "",
    "YOUR CHARTER",
    `Voice: ${input.charter.voice}`,
    `Beats: ${input.charter.beats.join(" · ")}`,
    `Standing positions: ${input.charter.opinions.map((o) => `"${o}"`).join(" ")}`,
    "",
    "YOUR STANDARDS",
    `Publish when: ${input.charter.standards.publish}`,
    `Spike when: ${input.charter.standards.spike}`,
    `Novelty: ${input.charter.standards.thresholds.novelty}`,
    `Substance: ${input.charter.standards.thresholds.substance}`,
    `Relevance: ${input.charter.standards.thresholds.relevance}`,
    `Hype resistance: ${input.charter.standards.thresholds.hypeResistance}`,
    "",
    input.priorDispatches.length
      ? `WHAT YOU HAVE ALREADY FILED (a story you have covered needs a genuine development to run again)\n${input.priorDispatches
          .map((d) => `- ${d.when} — "${d.title}": ${d.gist}`)
          .join("\n")}`
      : "WHAT YOU HAVE ALREADY FILED\nNothing yet — the wire is new.",
    "",
    memory
      ? `POSITIONS YOU HOLD (from your standing brief and past reasoning)\n${memory}`
      : "",
    "",
    // Told as facts and explicitly not as licence. Overnight the wire went
    // silent for nine hours; the refusals were all correct on the merits, but
    // the editor had no idea it was in a drought, so a merely-good story and a
    // sixth mediocre one looked identical to it. A newsroom knows the
    // difference. It is still free to spike everything, and told so.
    input.drought
      ? `TIMING
${
  input.drought.neverFiled
    ? `Your wire has been open for ${input.drought.minutes} minutes and you have not filed anything yet. A reader looking at it right now sees an empty publication.`
    : `You have not filed in ${Math.floor(input.drought.minutes / 60)} hours, and you have published ${input.drought.postsToday} of your ${input.drought.target} dispatches today.`
} If a candidate here genuinely clears your bar, run it rather than holding out for a better story that may never arrive. If none of them does, spiking the whole desk is still the right call — do not lower your standards to fill a quota.`
      : "",
    "",
    `TODAY'S DESK (${candidates.length} candidates)`,
    ...candidates.map((c, i) =>
      [
        `[${i}] ${c.title}`,
        `    source: ${c.sourceLabel} (${c.source})${c.signal ? ` · ${c.signal}` : ""}`,
        `    published: ${c.publishedAt}`,
        `    found via: "${c.keyword}"`,
        // Wide pickup cuts both ways and the editor is told so explicitly:
        // it can mean the story matters, or that it is a commodity
        // announcement every outlet reprinted from the same release.
        c.corroboration > 1
          ? `    also carried by ${c.corroboration - 1} other outlet(s): ${c.alsoReported.slice(1).join(", ")}`
          : "    carried by this outlet only",
        c.snippet ? `    excerpt: ${c.snippet.slice(0, 170)}` : "    excerpt: (none)",
      ].join("\n"),
    ),
    "",
    "Judge every candidate. Then pick at most one.",
  ].join("\n");

  const { value, provider } = await generateJson<RawDecision>(
    {
      label: "editorial-gate",
      system: SYSTEM,
      prompt,
      temperature: 0.4,
      maxTokens: 1800,
      timeoutMs: 25_000,
      prefer: input.prefer,
      // The gate runs many times an hour; it gets the cheap model with its own
      // daily budget so it cannot starve the writer. See lib/llm.ts.
      tier: "fast",
    },
    isRawDecision,
  );

  return { decision: normalise(value, candidates.length), provider };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

type RawDecision = {
  verdicts: Array<{
    index?: unknown;
    verdict?: unknown;
    score?: unknown;
    reason?: unknown;
  }>;
  winnerIndex?: unknown;
  winnerJustification?: unknown;
};

function isRawDecision(v: unknown): v is RawDecision {
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray((v as RawDecision).verdicts) &&
    (v as RawDecision).verdicts.length > 0
  );
}

/**
 * Coerces the model's judgement into something safe to act on.
 *
 * The winner is re-derived rather than trusted: models occasionally name a
 * winnerIndex they simultaneously marked "spike", or point past the end of the
 * array. A dispatch built on either would publish a story the editor just said
 * it was killing.
 */
function normalise(raw: RawDecision, count: number): EditorialDecision {
  const seen = new Set<number>();
  const verdicts: Verdict[] = [];

  for (const v of raw.verdicts) {
    const index = Number(v.index);
    if (!Number.isInteger(index) || index < 0 || index >= count || seen.has(index)) continue;
    seen.add(index);

    const verdict =
      v.verdict === "publish" || v.verdict === "hold" || v.verdict === "spike"
        ? v.verdict
        : "spike";

    verdicts.push({
      index,
      verdict,
      score: clamp(Number(v.score)),
      reason:
        typeof v.reason === "string" && v.reason.trim()
          ? v.reason.trim()
          : "No reason recorded.",
    });
  }

  // Anything the editor failed to mention is treated as spiked, so the spike
  // log stays a complete account of the desk rather than a partial one.
  for (let i = 0; i < count; i++) {
    if (!seen.has(i)) {
      verdicts.push({
        index: i,
        verdict: "spike",
        score: 0,
        reason: "Not reached — the editor did not rank this one.",
      });
    }
  }

  verdicts.sort((a, b) => a.index - b.index);

  const publishable = verdicts.filter((v) => v.verdict === "publish");
  const claimed = Number(raw.winnerIndex);
  const claimedIsValid =
    Number.isInteger(claimed) && publishable.some((v) => v.index === claimed);

  const winnerIndex = claimedIsValid
    ? claimed
    : publishable.length
      ? publishable.reduce((best, v) => (v.score > best.score ? v : best)).index
      : null;

  return {
    verdicts,
    winnerIndex,
    winnerJustification:
      typeof raw.winnerJustification === "string" && raw.winnerJustification.trim()
        ? raw.winnerJustification.trim()
        : "",
  };
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}
