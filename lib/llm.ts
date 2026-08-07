/**
 * Provider-agnostic text generation.
 *
 * Primary is Groq (llama-3.3-70b-versatile), fallback is Gemini 2.5 Flash.
 *
 * Two provider facts learned the hard way and encoded here: the Gemini free
 * tier reports `limit: 0` for gemini-2.0-flash on this key, and the 2.5 models
 * are only reachable on the `v1` path — `v1beta` 404s for them. Both are why
 * the constants below are what they are.
 *
 * The contract this module owes the rest of TAAR: it either returns usable text
 * or it throws. It never returns something empty and plausible-looking, because
 * a silent empty string downstream becomes a published blank dispatch.
 */

export type Provider = "groq" | "gemini";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`;

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
};

export type GenerateResult = {
  text: string;
  provider: Provider;
  ms: number;
  /** HTTP attempts made across all providers, for the run log. */
  attempts: number;
};

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
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

export async function generate(input: GenerateInput): Promise<GenerateResult> {
  const preferred: Provider = input.prefer ?? "groq";
  const order: Provider[] =
    preferred === "groq" ? ["groq", "gemini"] : ["gemini", "groq"];

  const startedAt = Date.now();
  const failures: string[] = [];
  let attempts = 0;

  for (const provider of order) {
    if (!hasKey(provider)) {
      failures.push(`${provider}: no API key configured`);
      continue;
    }

    // One retry per provider, but only for faults that a retry can fix.
    for (let attempt = 0; attempt < 2; attempt++) {
      attempts++;
      callsThisProcess++;
      try {
        const text = await callProvider(provider, input);
        if (!text.trim()) throw new RetryableError("empty completion");
        return { text, provider, ms: Date.now() - startedAt, attempts };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push(`${provider}: ${message}`);
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
      model: GROQ_MODEL,
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
  };
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
        // 2.5 Flash spends output budget on reasoning before it emits anything,
        // so a tight cap here returns MAX_TOKENS with empty text. Headroom is
        // cheaper than a mysterious blank.
        maxOutputTokens: (input.maxTokens ?? 1200) + 2048,
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
  };

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
  const detail = (await res.text().catch(() => "")).slice(0, 200);
  const message = `HTTP ${res.status} ${detail}`;

  // 429 and 5xx are worth a second look; anything else is our fault and a
  // retry just burns budget on the same rejection.
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
