import type { Charter } from "@/lib/schema";

/**
 * The Editorial Charter, rendered as the style guide pinned above a desk.
 *
 * This is the persona-agnostic core made visible: none of it is authored by us,
 * all of it was derived from the two words the evaluator supplied. Showing it
 * is what makes persona consistency checkable rather than asserted.
 */
export function CharterCard({
  charter,
  persona,
}: {
  charter: Charter;
  persona: { name: string; domain: string };
}) {
  return (
    <div className="border border-rule bg-paper-raised">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule px-5 py-3 sm:px-7">
        <p className="wire text-blue">Editorial charter</p>
        <p className="wire text-graphite">
          Generated at init from &ldquo;{persona.name}&rdquo; · &ldquo;{persona.domain}&rdquo;
        </p>
      </div>

      <div className="space-y-7 px-5 py-6 sm:px-7">
        <Field label="Voice">
          <p className="max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink">
            {charter.voice}
          </p>
        </Field>

        <Field label="Beats">
          <ul className="flex flex-wrap gap-x-2 gap-y-2">
            {charter.beats.map((b) => (
              <li key={b} className="wire border border-rule px-2 py-1 text-ink">
                {b}
              </li>
            ))}
          </ul>
        </Field>

        <Field label="Standing positions">
          <ul className="max-w-[62ch] space-y-2">
            {charter.opinions.map((o) => (
              <li
                key={o}
                className="border-l-2 border-blue pl-3 text-[0.9375rem] leading-relaxed text-ink"
              >
                {o}
              </li>
            ))}
          </ul>
        </Field>

        <Field label="The bar">
          <dl className="grid max-w-[70ch] gap-x-8 gap-y-3 sm:grid-cols-2">
            <Threshold term="Publish when" value={charter.standards.publish} />
            <Threshold term="Spike when" value={charter.standards.spike} />
            <Threshold term="Novelty" value={charter.standards.thresholds.novelty} />
            <Threshold term="Substance" value={charter.standards.thresholds.substance} />
            <Threshold term="Relevance" value={charter.standards.thresholds.relevance} />
            <Threshold
              term="Hype resistance"
              value={charter.standards.thresholds.hypeResistance}
            />
          </dl>
        </Field>

        <Field label="Source plan">
          <ul className="flex flex-wrap gap-x-2 gap-y-2">
            {charter.sourcePlan.map((s, i) => (
              <li key={s} className="wire text-graphite">
                {i > 0 ? (
                  <span aria-hidden="true" className="mr-2 text-rule">
                    /
                  </span>
                ) : null}
                {s}
              </li>
            ))}
          </ul>
        </Field>

        <Field label="Cadence">
          <p className="wire text-ink">
            {charter.cadence.postsPerDay} dispatches per day · minimum{" "}
            {charter.cadence.minGapMinutes} min between filings
          </p>
        </Field>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="wire mb-2.5 text-graphite">{label}</h3>
      {children}
    </div>
  );
}

function Threshold({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="wire text-graphite">{term}</dt>
      <dd className="mt-1 text-[0.875rem] leading-relaxed text-ink">{value}</dd>
    </div>
  );
}
