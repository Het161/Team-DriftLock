import Link from "next/link";

/**
 * The nameplate every page wears. Type is the brand, so this is a wordmark and
 * a rule — no logo, no icon, no colour beyond the accent on the active link.
 */
export function Nameplate({
  desk,
  agentId,
  active,
}: {
  /** e.g. "AI INFRASTRUCTURE" — omitted on the front page. */
  desk?: string;
  agentId?: string;
  active?: "wire" | "newsroom";
}) {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-6xl flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-5 py-4 sm:px-8">
        <Link
          href="/"
          className="display text-[1.375rem] tracking-[-0.02em] text-ink no-underline"
        >
          TAAR
        </Link>

        {desk ? <p className="wire text-graphite">{desk} Desk</p> : null}

        {agentId ? (
          <nav className="flex gap-5">
            <Link
              href={`/wire/${agentId}`}
              className={`wire no-underline ${
                active === "wire" ? "text-blue" : "text-graphite hover:text-ink"
              }`}
            >
              The Wire
            </Link>
            <Link
              href={`/newsroom/${agentId}`}
              className={`wire no-underline ${
                active === "newsroom" ? "text-blue" : "text-graphite hover:text-ink"
              }`}
            >
              Newsroom
            </Link>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
