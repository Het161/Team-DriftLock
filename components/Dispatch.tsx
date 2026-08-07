import type { PostDoc } from "@/lib/schema";
import { dateline, hostOf } from "@/lib/format";

/**
 * A dispatch as copy on an editor's desk.
 *
 * The signature element is the rationale set as blue-pencil marginalia: on
 * desktop it sits in the right margin, joined to the copy by a thin blue tick;
 * on mobile it collapses to a tappable reveal.
 *
 * That responsive switch renders the note twice and hides one with display:none,
 * rather than trying to force a <details> open at one breakpoint and closed at
 * another. CSS cannot toggle the `open` attribute, and the alternatives either
 * depend on ::details-content support or fail by hiding the single most
 * distinctive thing on the page. One duplicated paragraph of markup is a much
 * cheaper price than that failure mode, and display:none keeps it out of the
 * accessibility tree either way.
 */
export function Dispatch({
  post,
  domain,
  isLead,
}: {
  post: PostDoc;
  domain: string;
  /** The newest dispatch types its slug in. Only ever one per page. */
  isLead?: boolean;
}) {
  const slug = dateline(domain.toUpperCase(), post.createdAt);
  const paragraphs = post.text.split(/\n{2,}/).filter((p) => p.trim());

  return (
    <article className="border-t border-rule py-10 first:border-t-0 first:pt-0">
      <p className="wire text-graphite">
        <span
          className={isLead ? "teletype" : undefined}
          style={isLead ? ({ "--chars": slug.length } as React.CSSProperties) : undefined}
        >
          {slug}
        </span>
      </p>

      <div className="mt-6 grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,68ch)_minmax(0,16rem)]">
        <div className="min-w-0">
          <div className="space-y-4 text-[1.0625rem] leading-[1.68] text-ink">
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>

          <div className="mt-7 border-t border-rule pt-3">
            <p className="wire text-graphite">Sources</p>
            <ul className="mt-2 space-y-1.5">
              {post.sources.map((s) => (
                <li key={s}>
                  <a
                    href={s}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="wire break-all text-blue underline decoration-blue/30 underline-offset-4 transition-colors hover:decoration-blue"
                  >
                    {hostOf(s)}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Mobile: the note collapses out of the way. */}
          <details className="mt-6 border-t border-rule pt-3 lg:hidden">
            <summary className="wire cursor-pointer list-none text-blue marker:hidden">
              Editor&rsquo;s note
              <span aria-hidden="true" className="ml-1.5">
                +
              </span>
            </summary>
            <p className="mt-3 text-[0.875rem] leading-[1.6] text-blue">
              {post.rationale}
            </p>
          </details>
        </div>

        {/* Desktop: the note is hand-placed in the margin, tick and all. */}
        <aside className="relative hidden lg:block">
          <span
            aria-hidden="true"
            className="absolute -left-10 top-[0.45rem] h-px w-6 bg-blue"
          />
          <p className="wire text-blue">Editor&rsquo;s note</p>
          <p className="mt-2.5 text-[0.8125rem] leading-[1.55] text-blue">
            {post.rationale}
          </p>
        </aside>
      </div>
    </article>
  );
}
