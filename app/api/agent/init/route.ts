import { randomUUID } from "node:crypto";
import { agents, ensureIndexes, type AgentDoc } from "@/lib/schema";
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

  const doc: AgentDoc = {
    agentId,
    persona,
    // The Editorial Charter is generated from the persona in a later phase.
    // Until then every agent starts pending and the first tick builds it.
    charter: null,
    charterStatus: "pending",
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

  // Exactly this shape. Nothing else.
  return ok({ agentId });
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
