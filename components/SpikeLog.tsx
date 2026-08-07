import type { RejectionDoc } from "@/lib/schema";
import { Stamp } from "./Stamp";
import { wireDate, hostOf } from "@/lib/format";

/**
 * The Spike — every story the editor refused, and why.
 *
 * A wire that shows only what it published is indistinguishable from one with
 * no judgement at all, so this is a first-class artifact rather than exhaust.
 * The headline is struck through and the reason is given verbatim; nothing is
 * softened, because a blunt refusal is the evidence.
 */
export function SpikeLog({ spikes }: { spikes: RejectionDoc[] }) {
  if (!spikes.length) {
    return (
      <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed text-graphite">
        Nothing spiked yet. The editor logs every story it refuses, with the
        reason, as soon as it starts reading.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-rule border-y border-rule">
      {spikes.map((s) => (
        <li key={s.id} className="grid gap-x-6 gap-y-3 py-5 sm:grid-cols-[7rem_1fr]">
          <div className="flex items-start">
            <Stamp verdict={s.verdict === "hold" ? "hold" : "spike"} />
          </div>

          <div className="min-w-0">
            <p className="max-w-[62ch] text-[0.9375rem] leading-snug text-graphite line-through decoration-graphite/50">
              {s.title}
            </p>

            <p className="wire mt-2 text-graphite">
              {s.source} · {wireDate(s.createdAt)} · scored {s.score}/100
            </p>

            <p className="mt-2 max-w-[62ch] text-[0.875rem] leading-relaxed text-ink">
              {s.reason}
            </p>

            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="wire mt-2 inline-block break-all text-blue underline decoration-blue/30 underline-offset-4 hover:decoration-blue"
            >
              {hostOf(s.url)}
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}
