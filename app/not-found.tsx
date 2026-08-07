import Link from "next/link";

/**
 * The 404, in the product's own vernacular.
 *
 * Reached mainly by notFound() from /wire/[agentId] and /newsroom/[agentId]
 * when an agent id does not exist — a mistyped or expired id is the likeliest
 * wrong turn anyone takes here, so the copy answers that case specifically
 * rather than shrugging. Next's default 404 is unstyled and would be the only
 * page in the product that looks like a different product.
 */
export default function NotFound() {
  return (
    <>
      <header className="border-b border-rule">
        <div className="mx-auto max-w-6xl px-5 py-4 sm:px-8">
          <Link
            href="/"
            className="display text-[1.375rem] tracking-[-0.02em] text-ink no-underline"
          >
            TAAR
          </Link>
        </div>
      </header>

      <main className="mx-auto flex min-h-[70vh] max-w-6xl flex-col justify-center px-5 sm:px-8">
        <p className="wire text-graphite">Error 404 · No such page</p>

        <h1 className="display mt-5 max-w-[18ch] text-[clamp(2.5rem,8vw,5rem)]">
          Nothing filed under that slug.
        </h1>

        <p className="mt-6 max-w-[54ch] text-lg leading-relaxed text-graphite">
          If you were looking for a publication, check the agent id — every wire
          lives at <span className="wire normal-case tracking-normal text-ink">/wire/&lt;agentId&gt;</span>,
          and the id is the one returned by{" "}
          <span className="wire text-ink">POST</span>
          <span className="wire normal-case tracking-normal text-ink"> /api/agent/init</span>.
        </p>

        <div className="mt-9">
          <Link
            href="/"
            className="wire border border-ink px-4 py-2.5 text-ink no-underline transition-colors hover:border-blue hover:text-blue"
          >
            Back to the front page
          </Link>
        </div>
      </main>
    </>
  );
}
