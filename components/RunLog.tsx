import type { RunDoc } from "@/lib/schema";
import { wireDate } from "@/lib/format";

/**
 * The wire log — every cycle, whether or not it published.
 *
 * Set in mono and read as a machine record, but on paper rather than on a black
 * terminal: the product's whole surface is paper, and a dark panel here would
 * be a second visual language for no reason. Quiet cycles are shown, not
 * hidden. They are most of the log, and they are the evidence that the editor
 * is choosing rather than emitting.
 */
export function RunLog({ runs }: { runs: RunDoc[] }) {
  if (!runs.length) {
    return (
      <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed text-graphite">
        No cycles recorded yet.
      </p>
    );
  }

  return (
    <ol className="divide-y divide-rule border-y border-rule">
      {runs.map((r) => (
        <li key={r.runId} className="py-3.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="wire text-graphite">{wireDate(r.startedAt)}</span>
            <span className={`wire ${outcomeColour(r.outcome)}`}>{r.outcome}</span>
            <span className="wire text-graphite">
              via {r.trigger} · {r.candidatesFound} found · {r.candidatesAfterDedupe} fresh
              {r.spiked ? ` · ${r.spiked} spiked` : ""}
              {r.published ? ` · ${r.published} filed` : ""}
              {r.llmCalls ? ` · ${r.llmCalls} llm` : ""}
              {r.durationMs ? ` · ${(r.durationMs / 1000).toFixed(1)}s` : ""}
            </span>
          </div>

          {r.notes.length ? (
            <ul className="mt-1.5 space-y-0.5">
              {r.notes.map((n, i) => (
                <li key={i} className="wire max-w-[76ch] text-graphite normal-case tracking-normal">
                  <span aria-hidden="true" className="mr-1.5 text-rule">
                    ·
                  </span>
                  {n}
                </li>
              ))}
            </ul>
          ) : null}

          {r.error ? (
            <p className="wire mt-1.5 text-stamp normal-case tracking-normal">{r.error}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function outcomeColour(outcome: RunDoc["outcome"]): string {
  // stamp-red is reserved: an error is the only non-spike thing urgent enough
  // to earn it, and that is exactly the "URGENT" half of the rule.
  if (outcome === "error") return "text-stamp";
  if (outcome === "published") return "text-blue";
  return "text-graphite";
}
