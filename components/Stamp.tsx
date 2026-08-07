/**
 * A rubber stamp.
 *
 * SPIKED is the only place stamp-red is permitted to appear anywhere in the
 * product. HELD and PUBLISHED are real verdicts but not refusals, so they take
 * graphite and blue-pencil — if red ever shows up outside a spike, the palette
 * rule has been broken and it should be removed rather than justified.
 *
 * The ink texture is a border plus an offset outline, not a shadow. Shadows are
 * banned by the design system, including inset ones; two rules a hair apart
 * read as an over-inked edge where the stamp rocked, and outline does it
 * without participating in layout or faking depth. Rotation lives in .stamp so
 * the resting angle and the settle animation cannot drift apart.
 */
export function Stamp({ verdict }: { verdict: "spike" | "hold" | "publish" }) {
  if (verdict === "spike") {
    return (
      <span className="stamp inline-block border-2 border-stamp px-2 py-0.5 text-stamp outline outline-1 outline-offset-2 outline-stamp/30">
        <span className="wire font-medium">Spiked</span>
      </span>
    );
  }

  if (verdict === "hold") {
    return (
      <span className="inline-block border border-graphite px-2 py-0.5 text-graphite">
        <span className="wire">Held</span>
      </span>
    );
  }

  return (
    <span className="inline-block border border-blue px-2 py-0.5 text-blue">
      <span className="wire">Published</span>
    </span>
  );
}
