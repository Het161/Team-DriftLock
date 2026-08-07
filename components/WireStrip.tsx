import { wireClock, ago } from "@/lib/format";
import type { WireStatus } from "@/lib/queries";

/**
 * The live ticker across the top of the front page.
 *
 * Every value is read from Mongo at request time — the last cycle, the last
 * dispatch, the running counts. Nothing here is hardcoded, because a status
 * strip that lies is worse than no status strip.
 *
 * It never promises a next-run time. GitHub's scheduler drifts by 5-15 minutes
 * under load, so "next cycle at 16:30" would be wrong often enough to notice.
 * The honest claim is the cadence and when it last ran.
 */
export function WireStrip({
  status,
  desk,
}: {
  status: WireStatus;
  desk: string;
}) {
  const open = status.lastTickAt !== null;

  return (
    <div className="border-b border-rule">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-1.5 px-5 py-3 sm:px-8">
        <span className="wire text-blue">
          {open ? "Wire open" : "Wire opening"}
        </span>
        <span aria-hidden="true" className="wire text-rule">
          /
        </span>
        <span className="wire text-graphite">{desk} desk</span>
        <span aria-hidden="true" className="wire text-rule">
          /
        </span>
        <span className="wire text-graphite">
          {status.dispatchCount} filed · {status.spikeCount} spiked ·{" "}
          {status.tickCount} cycles
        </span>
        <span aria-hidden="true" className="wire text-rule">
          /
        </span>
        <span className="wire text-graphite">
          {status.lastTickAt
            ? `Last cycle ${wireClock(status.lastTickAt)}`
            : "Awaiting first cycle"}
        </span>
        {status.lastPostAt ? (
          <>
            <span aria-hidden="true" className="wire text-rule">
              /
            </span>
            <span className="wire text-ink">
              Last dispatch {ago(status.lastPostAt)}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
