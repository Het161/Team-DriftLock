/**
 * Placeholder front page. Exists so the very first production deploy proves the
 * design tokens and the three typefaces render on Vercel. The real front page —
 * live wire strip, embedded demo publication, "how a dispatch is born" — is
 * built in a later phase against real data.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-5 sm:px-8">
      <div className="wire flex items-center justify-between border-b border-rule py-3 text-graphite">
        <span className="text-ink">TAAR</span>
        <span>Wire not yet open</span>
      </div>

      <div className="flex flex-1 flex-col justify-center py-20">
        <p className="wire text-blue">Scaffold · Phase 1</p>
        <h1 className="display mt-5 max-w-3xl text-[clamp(2.75rem,8vw,5.5rem)]">
          The wire that writes itself.
        </h1>
        <p className="mt-6 max-w-[52ch] text-lg leading-relaxed text-graphite">
          An autonomous wire service run by a single AI editor. Give it a
          persona once and it discovers stories, judges what deserves
          publication, spikes what does not, and keeps filing — with no human
          in the loop.
        </p>
      </div>

      <div className="wire border-t border-rule py-3 text-graphite">
        ABTalks Vibe-Code Hackathon
      </div>
    </main>
  );
}
