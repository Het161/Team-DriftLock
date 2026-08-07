import type { AgentDoc } from "@/lib/schema";
import { ago } from "@/lib/format";

/**
 * What the editor remembers.
 *
 * These are edges from the Breeth knowledge graph — natural-language statements
 * it extracted from the episodes the agent wrote about its own work.
 *
 * Shown as the recall from the most recent cycle rather than a fresh query,
 * because this is the memory that actually informed the last decision. A live
 * lookup would be a different question with a different answer, and would make
 * a page render depend on a third-party API.
 *
 * Only `fact` is rendered. Breeth also returns intent_meta.edge_kind and
 * why_connected per edge, and both are unreliably aligned with the fact they
 * are attached to — checked against the raw API, the edge "Kaveri covers
 * Sustainable AI Data Centers" came back annotated "states Kaveri's position on
 * proprietary chip architectures moving toward open standards". Roughly half
 * matched. On a page whose entire purpose is showing that the editor's memory
 * is real, displaying an explanation that contradicts the thing it explains is
 * worse than showing nothing. The fields are still stored, so if the alignment
 * improves they can be surfaced without another migration.
 */
export function MemoryPanel({ agent }: { agent: AgentDoc }) {
  const snapshot = agent.memorySnapshot;

  if (!snapshot?.facts.length) {
    return (
      <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed text-graphite">
        Memory is still empty. The editor writes what it argued after each
        dispatch, and starts recalling it on the next cycle.
      </p>
    );
  }

  return (
    <>
      <p className="wire mb-4 text-graphite">
        Recalled {ago(snapshot.at)} · {snapshot.facts.length} facts
      </p>

      <ul className="divide-y divide-rule border-y border-rule">
        {snapshot.facts.map((f, i) => (
          <li key={i} className="py-3">
            <p className="max-w-[68ch] text-[0.9375rem] leading-relaxed text-ink">
              {f.fact}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
