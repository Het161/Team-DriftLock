/**
 * Provider-agnostic text generation.
 *
 * Primary is Groq (llama-3.3-70b-versatile), fallback is Gemini 2.5 Flash.
 *
 * Two provider facts learned the hard way: the Gemini free tier reports
 * `limit: 0` for gemini-2.0-flash on this key, and Groq's real ceiling is
 * tokens per day, not requests — see the token counter below.
 *
 * The contract this module owes the rest of TAAR: it either returns usable text
 * or it throws. It never returns something empty and plausible-looking, because
 * a silent empty string downstream becomes a published blank dispatch.
 */

export type Provider = "groq" | "gemini";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Two models, because Groq's free limits are per-model and the work is not
 * uniform.
 *
 * The 70b's ceiling is 100,000 tokens a day, which one agent's editorial gate
 * alone will eat: judging costs roughly 2,000 tokens and runs many times an
 * hour, while writing costs about the same and runs three times a day. Judging
 * on the same model as writing meant the cheap, frequent task exhausted the
 * budget for the expensive, rare one — and the wire went dark with the quality
 * model untouched.
 *
 * So the gate runs on llama-3.1-8b-instant, which has its own daily bucket and
 * produced the same six-verdict JSON in 465 tokens against the 70b's ~2,000.
 * Drafting stays on the 70b, where the difference is actually legible to a
 * reader. gpt-oss-20b was tried first and rejected: it cannot hold JSON mode.
 */
const GROQ_MODELS = {
  quality: "llama-3.3-70b-versatile",
  fast: "llama-3.1-8b-instant",
} as const;

export type Tier = keyof typeof GROQ_MODELS;

const GEMINI_MODEL = "gemini-2.5-flash";
// v1beta, not v1. v1 rejects BOTH systemInstruction and JSON mode with
// "not enabled for api version v1" — and every real call here uses both. The
// original choice of v1 came from a probe that sent neither, so the fallback
// passed a test it could only fail in production, which is exactly what it did
// the first time Groq ran out. Re-probed field by field: v1beta accepts both.
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const DEFAULT_TIMEOUT_MS = 20_000;

export type GenerateInput = {
  /** What this call is for. Appears in run logs, so keep it short and factual. */
  label: string;
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for a JSON object rather than prose. */
  json?: boolean;
  timeoutMs?: number;
  /** Try this provider first — the daily budget guard uses it to shed Groq load. */
  prefer?: Provider;
  /**
   * "fast" for high-frequency structured work (the editorial gate), "quality"
   * for anything a reader sees. Defaults to quality — the safer mistake.
   */
  tier?: Tier;
};

export type GenerateResult = {
  text: string;
  provider: Provider;
  ms: number;
  /** HTTP attempts made across all providers, for the run log. */
  attempts: number;
};

/**
 * Tokens are the binding constraint, not requests.
 *
 * Groq's free tier caps llama-3.3-70b at 100,000 tokens per DAY, and that limit
 * appears nowhere in the response headers — only in the body of the 429 that
 * kills you. Watching x-ratelimit-remaining-requests said 998/1000 left while
 * the account was actually at 96.7k/100k tokens and minutes from dead. So usage
 * is now read out of each response and totalled.
 */
let tokensThisProcess = 0;
export function llmTokensUsed(): number {
  return tokensThisProcess;
}

export class LlmUnavailableError extends Error {
  readonly failures: string[];
  constructor(label: string, failures: string[]) {
    super(`All LLM providers failed for "${label}": ${failures.join(" | ")}`);
    this.name = "LlmUnavailableError";
    this.failures = failures;
  }
}

/* -------------------------------------------------------------------------- */
/* Per-process call accounting                                                 */
/* -------------------------------------------------------------------------- */

let callsThisProcess = 0;
export function llmCallsUsed(): number {
  return callsThisProcess;
}
export function resetLlmCalls(): void {
  callsThisProcess = 0;
  tokensThisProcess = 0;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

export async function generate(input: GenerateInput): Promise<GenerateResult> {
  const tier: Tier = input.tier ?? "quality";
  const preferred: Provider = input.prefer ?? "groq";

  /**
   * The attempt chain, in descending order of preference.
   *
   * The last step is the point: a quality-tier call that has exhausted both the
   * good model and the fallback drops to the fast model rather than failing.
   * On a free tier the honest choice is a dispatch written by a smaller model
   * against no dispatch at all — the wire going dark is the worse outcome, and
   * the run log records which model wrote it either way.
   */
  const chain: Array<{ provider: Provider; tier: Tier }> =
    preferred === "groq"
      ? [
          { provider: "groq", tier },
          { provider: "gemini", tier },
          ...(tier === "quality" ? [{ provider: "groq" as Provider, tier: "fast" as Tier }] : []),
        ]
      : [
          { provider: "gemini", tier },
          { provider: "groq", tier },
          ...(tier === "quality" ? [{ provider: "groq" as Provider, tier: "fast" as Tier }] : []),
        ];

  const startedAt = Date.now();
  const failures: string[] = [];
  let attempts = 0;

  for (const step of chain) {
    if (!hasKey(step.provider)) {
      failures.push(`${step.provider}: no API key configured`);
      continue;
    }

    // One retry per step, but only for faults a retry can actually fix.
    for (let attempt = 0; attempt < 2; attempt++) {
      attempts++;
      callsThisProcess++;
      try {
        const text = await callProvider(step.provider, { ...input, tier: step.tier });
        if (!text.trim()) throw new RetryableError("empty completion");
        return { text, provider: step.provider, ms: Date.now() - startedAt, attempts };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push(`${step.provider}/${step.tier}: ${message}`);
        if (!(err instanceof RetryableError) || attempt === 1) break;
        await sleep(600);
      }
    }
  }

  throw new LlmUnavailableError(input.label, failures);
}

/**
 * Generation that must return a JSON object.
 *
 * Models wrap JSON in prose or fences often enough that parsing has to be
 * defensive rather than optimistic, and a second attempt with a blunter
 * instruction recovers most of what the first one mangles.
 */
export async function generateJson<T>(
  input: GenerateInput,
  validate: (value: unknown) => value is T,
): Promise<{ value: T; provider: Provider; ms: number; attempts: number }> {
  const failures: string[] = [];

  for (let round = 0; round < 2; round++) {
    const res = await generate({
      ...input,
      json: true,
      prompt:
        round === 0
          ? input.prompt
          : `${input.prompt}\n\nReturn ONLY a raw JSON object. No prose, no markdown fences, no commentary.`,
    });

    const parsed = extractJson(res.text);
    if (parsed !== null && validate(parsed)) {
      return { value: parsed, provider: res.provider, ms: res.ms, attempts: res.attempts };
    }
    failures.push(
      parsed === null
        ? `unparseable JSON: ${res.text.slice(0, 160)}`
        : `JSON failed validation: ${JSON.stringify(parsed).slice(0, 160)}`,
    );
  }

  throw new LlmUnavailableError(input.label, failures);
}

/* -------------------------------------------------------------------------- */
/* Providers                                                                   */
/* -------------------------------------------------------------------------- */

function hasKey(provider: Provider): boolean {
  return provider === "groq"
    ? Boolean(process.env.GROQ_API_KEY)
    : Boolean(process.env.GEMINI_API_KEY);
}

async function callProvider(provider: Provider, input: GenerateInput): Promise<string> {
  return provider === "groq" ? callGroq(input) : callGemini(input);
}

async function callGroq(input: GenerateInput): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODELS[input.tier ?? "quality"],
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.prompt },
      ],
      temperature: input.temperature ?? 0.6,
      max_tokens: input.maxTokens ?? 1200,
      ...(input.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!res.ok) throw await httpError("groq", res);

  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number };
  };
  tokensThisProcess += body.usage?.total_tokens ?? 0;
  return body.choices?.[0]?.message?.content ?? "";
}

async function callGemini(input: GenerateInput): Promise<string> {
  const res = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: input.system }] },
      contents: [{ role: "user", parts: [{ text: input.prompt }] }],
      generationConfig: {
        temperature: input.temperature ?? 0.6,
        maxOutputTokens: (input.maxTokens ?? 1200) + 256,
        // Thinking off. 2.5 Flash spends its output budget reasoning before it
        // emits anything, which truncated the editorial gate's JSON mid-object
        // on its first real use. Measured on an identical judging prompt: 823
        // thought tokens to produce 441 of answer, versus 0 and 471 with this
        // set — same result, 60% fewer tokens, and no way to run out of budget
        // mid-object. On a 100k/day ceiling that difference is the whole day.
        thinkingConfig: { thinkingBudget: 0 },
        ...(input.json ? { responseMimeType: "application/json" } : {}),
      },
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!res.ok) throw await httpError("gemini", res);

  const body = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    usageMetadata?: { totalTokenCount?: number };
  };
  tokensThisProcess += body.usageMetadata?.totalTokenCount ?? 0;

  const candidate = body.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

  if (!text.trim() && candidate?.finishReason) {
    throw new RetryableError(`no text, finishReason=${candidate.finishReason}`);
  }
  return text;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

class RetryableError extends Error {}

async function httpError(provider: Provider, res: Response): Promise<Error> {
  const detail = (await res.text().catch(() => "")).slice(0, 400);
  const message = `HTTP ${res.status} ${detail.slice(0, 200)}`;

  // A daily quota is not a transient fault. Retrying one spends a second
  // request from an allowance that is already gone to be told the same thing —
  // and Gemini's free tier here is twenty requests a day, so two wasted on a
  // retry is ten percent of the day's capacity.
  const exhaustedForToday = /per ?day|PerDay|TPD|quota/i.test(detail);

  if (res.status === 429 && exhaustedForToday) return new Error(message);
  if (res.status === 429 || res.status >= 500) return new RetryableError(message);
  return new Error(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractJson(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through to salvage */
  }

  // Salvage: take the widest brace/bracket span and try that.
  const start = cleaned.search(/[{[]/);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      /* genuinely unusable */
    }
  }
  return null;
}
