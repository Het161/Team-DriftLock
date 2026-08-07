import { generateJson, type Provider } from "./llm";
import type { Charter } from "./schema";

/**
 * The Editorial Charter — TAAR's persona-agnostic core.
 *
 * The evaluator chooses the persona, so nothing about the product may be
 * hardcoded to one identity. This single LLM call turns {name, domain} into a
 * standing editorial identity, and every later decision reads from it: what to
 * look for, what clears the bar, what voice to write in, how often to file.
 *
 * Persona consistency across 48 hours is a consequence of writing this once and
 * obeying it, rather than of re-describing the persona in every prompt and
 * hoping the descriptions agree.
 */

const SYSTEM = `You are an experienced masthead editor designing the standing brief for a new wire correspondent.

You will be given only a name and a subject domain. From those, write the charter that will govern everything this correspondent publishes for the next several days, without further human input.

Rules:
- Derive everything from the given domain. Never assume a domain you were not given.
- Opinions must be genuinely arguable positions a thoughtful person in the field could dispute — not truisms, not "AI is important", not both-sides hedging.
- The publishing bar must be strict enough that most stories fail it. A correspondent who publishes everything has no editorial judgement.
- sourcePlan entries are search queries, 2-4 words each, of the kind that work against news and research indexes. Not questions, not sentences.
- Write the voice description so that two different writers following it would produce recognisably similar prose.

Return a single JSON object with exactly these keys:
{
  "voice": "3-4 sentences on tone, sentence rhythm, and signature verbal habits",
  "beats": ["4-6 specific sub-topics within the domain"],
  "opinions": ["3-5 standing editorial positions, specific and arguable"],
  "standards": {
    "publish": "what clears the bar",
    "spike": "what gets killed",
    "thresholds": {
      "novelty": "how new it must be to matter",
      "substance": "what counts as substance over announcement",
      "relevance": "how tightly it must sit inside the beats",
      "hypeResistance": "what marketing language gets a story killed"
    }
  },
  "sourcePlan": ["6-10 short search queries"],
  "cadence": { "postsPerDay": 3, "minGapMinutes": 120 }
}`;

export async function buildCharter(
  persona: { name: string; domain: string },
  prefer?: Provider,
): Promise<{ charter: Charter; provider: Provider }> {
  const { value, provider } = await generateJson<RawCharter>(
    {
      label: "charter",
      system: SYSTEM,
      prompt: `Correspondent name: ${persona.name}\nDomain: ${persona.domain}\n\nWrite the charter.`,
      temperature: 0.7,
      maxTokens: 1600,
      timeoutMs: 25_000,
      prefer,
    },
    isRawCharter,
  );

  return { charter: normalise(value, persona), provider };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

type RawCharter = {
  voice: string;
  beats: string[];
  opinions: string[];
  standards: {
    publish?: string;
    spike?: string;
    thresholds?: Record<string, unknown>;
  };
  sourcePlan: string[];
  cadence?: { postsPerDay?: unknown; minGapMinutes?: unknown };
};

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x.trim());

function isRawCharter(v: unknown): v is RawCharter {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.voice === "string" &&
    c.voice.trim().length > 20 &&
    isStringArray(c.beats) &&
    isStringArray(c.opinions) &&
    isStringArray(c.sourcePlan) &&
    typeof c.standards === "object" &&
    c.standards !== null
  );
}

/**
 * Clamps the model's output into the ranges the spec fixes.
 *
 * The model is asked for 3-5 posts a day and a >=90 minute gap, and mostly
 * complies — but "mostly" over 48 unattended hours is the difference between a
 * coherent wire and one that files nine times in an hour. The bounds are
 * enforced here rather than trusted.
 */
function normalise(raw: RawCharter, persona: { name: string; domain: string }): Charter {
  const thresholds = (raw.standards.thresholds ?? {}) as Record<string, unknown>;
  const str = (v: unknown, fallback: string) =>
    typeof v === "string" && v.trim() ? v.trim() : fallback;

  return {
    voice: raw.voice.trim(),
    beats: raw.beats.map((b) => b.trim()).filter(Boolean).slice(0, 6),
    opinions: raw.opinions.map((o) => o.trim()).filter(Boolean).slice(0, 5),
    standards: {
      publish: str(
        raw.standards.publish,
        `A story that materially advances understanding of ${persona.domain}.`,
      ),
      spike: str(
        raw.standards.spike,
        "Announcements, restatements of known facts, and marketing dressed as news.",
      ),
      thresholds: {
        novelty: str(thresholds.novelty, "Must contain something not already widely reported."),
        substance: str(thresholds.substance, "Must carry detail, numbers, or a verifiable claim."),
        relevance: str(thresholds.relevance, "Must sit inside one of the named beats."),
        hypeResistance: str(
          thresholds.hypeResistance,
          "Superlatives without evidence are disqualifying.",
        ),
      },
    },
    sourcePlan: raw.sourcePlan.map((s) => s.trim()).filter(Boolean).slice(0, 10),
    cadence: {
      postsPerDay: clamp(toNumber(raw.cadence?.postsPerDay, 4), 3, 5),
      minGapMinutes: clamp(toNumber(raw.cadence?.minGapMinutes, 120), 90, 360),
    },
  };
}

function toNumber(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}
