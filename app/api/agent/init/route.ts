import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { agents, ensureIndexes, type AgentDoc, type Charter } from "@/lib/schema";
import { buildCharter } from "@/lib/charter";
import { remember } from "@/lib/breeth";
import { ok, fail } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Charter generation (added in a later phase) makes one LLM call here. Vercel
// Hobby with Fluid compute allows this; init must have room to think once.
export const maxDuration = 60;

/** Long personas are truncated rather than rejected — never fail the caller. */
const MAX_FIELD = 300;

type ParsedPersona = { name: string; domain: string };

function parsePersona(body: unknown): ParsedPersona | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;

  const persona = (body as Record<string, unknown>).persona;
  if (typeof persona !== "object" || persona === null || Array.isArray(persona)) {
    return null;
  }

  const { name, domain } = persona as Record<string, unknown>;
  if (typeof name !== "string" || typeof domain !== "string") return null;

  const trimmedName = name.trim();
  const trimmedDomain = domain.trim();
  if (!trimmedName || !trimmedDomain) return null;

  // Extra fields on persona are tolerated and ignored, per the contract.
  return {
    name: trimmedName.slice(0, MAX_FIELD),
    domain: trimmedDomain.slice(0, MAX_FIELD),
  };
}

/**
 * POST /api/agent/init
 *
 * Called exactly once by the evaluator, before evaluation begins.
 * Request:  { "persona": { "name": "Ada", "domain": "AI Security" } }
 * Response: { "agentId": "…" }
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "invalid_json", "Request body must be valid JSON.");
  }

  const persona = parsePersona(body);
  if (!persona) {
    return fail(
      400,
      "invalid_persona",
      "Expected body { persona: { name: string, domain: string } } with both fields non-empty.",
    );
  }

  const now = new Date().toISOString();
  const agentId = randomUUID();

  // The charter is the persona-agnostic core: one LLM call turns {name, domain}
  // into the standing editorial identity every later decision reads from.
  //
  // It is attempted here but never required. If the model is slow or down, the
  // agent is created with charterStatus "pending" and the first tick builds it
  // instead. Init returning 500 because a model hiccuped would fail the
  // evaluation before it started, which is a far worse outcome than a charter
  // that arrives thirty minutes late.
  let charter: Charter | null = null;
  let charterStatus: AgentDoc["charterStatus"] = "pending";

  try {
    // TEMPORARY, test-only. Set TAAR_FORCE_CHARTER_FAILURE=1 in the environment
    // to exercise the pending-charter recovery path against production without
    // breaking real traffic or waiting for a genuine provider outage. Removed
    // once that path has been proven live. Absent the variable this is a no-op.
    if (process.env.TAAR_FORCE_CHARTER_FAILURE === "1") {
      throw new Error("forced charter failure (test flag)");
    }
    const built = await withTimeout(buildCharter(persona), CHARTER_TIMEOUT_MS);
    charter = built.charter;
    charterStatus = "ready";
  } catch {
    charterStatus = "pending";
  }

  const doc: AgentDoc = {
    agentId,
    persona,
    charter,
    charterStatus,
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastPostAt: null,
    postCount: 0,
  };

  try {
    await ensureIndexes();
    await (await agents()).insertOne(doc);
  } catch (err) {
    return fail(
      500,
      "init_failed",
      err instanceof Error ? err.message : "Could not create the agent.",
    );
  }

  // Memory is seeded with the charter so the very first editorial decision has
  // something to recall — but the evaluator should not wait on it. Awaiting the
  // Breeth write inline pushed init to ~18s in production; after() runs it once
  // the response has already been sent. Nothing downstream depends on it having
  // finished, and remember() never throws.
  if (charter) {
    const seed = charter;
    after(async () => {
      await remember(agentId, persona.name, [
        `covers ${persona.domain} for the TAAR wire.`,
        `works these beats: ${seed.beats.join(", ")}.`,
        ...seed.opinions.map((o) => `holds this position: ${o}`),
      ]);
    });
  }

  // Exactly this shape. Nothing else.
  return ok({ agentId });
}

/**
 * 12 seconds, not the 8 originally specified.
 *
 * Init is called once and awaited, never polled, so a few extra seconds cost
 * the evaluator nothing — while the difference between a charter that lands
 * here and one that lands on the first tick is whether the agent can file a
 * dispatch immediately or has to spend its first cycle writing its own brief.
 * Still far enough inside maxDuration=60 to be safe.
 */
const CHARTER_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}
