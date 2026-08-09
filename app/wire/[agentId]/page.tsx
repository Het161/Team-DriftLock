import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Nameplate } from "@/components/Nameplate";
import { Dispatch } from "@/components/Dispatch";
import { getAgent, getAgentIds, getDispatches, getWireStatus } from "@/lib/queries";
import { wireClock, ago } from "@/lib/format";

/**
 * Cached for ten seconds, then regenerated.
 *
 * This said "the wire is live, nothing about this page may be cached", which
 * was a principle stated without measuring what it cost: 4.3s to the first
 * visitor after the function went idle, 0.87s warm. A judge arriving cold got
 * the 4.3s.
 *
 * Ten seconds of staleness is invisible on a page whose content changes every
 * thirty minutes, and Next serves the existing copy while it rebuilds, so
 * nobody waits for a render again. The liveness that actually matters is
 * GET /api/agent/feed, which stays uncached — that is the contract.
 */
export const revalidate = 10;

/**
 * The existing agents, warm before anyone asks. `dynamicParams` stays at its
 * default of true, so an agent created after the build still renders on first
 * request and is cached from then on.
 */
export async function generateStaticParams() {
  return (await getAgentIds()).map((agentId) => ({ agentId }));
}

type Props = { params: Promise<{ agentId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { agentId } = await params;
  const agent = await getAgent(agentId);
  if (!agent) return { title: "Unknown agent" };
  const description = `Dispatches found, judged and filed autonomously by ${agent.persona.name}, covering ${agent.persona.domain}.`;
  return {
    title: `${agent.persona.name} — the ${agent.persona.domain} desk`,
    description,
    openGraph: {
      title: `${agent.persona.name} — the ${agent.persona.domain} desk · TAAR`,
      description,
    },
  };
}

export default async function WirePage({ params }: Props) {
  const { agentId } = await params;

  const agent = await getAgent(agentId);
  if (!agent) notFound();

  const [dispatches, status] = await Promise.all([
    getDispatches(agentId),
    getWireStatus(agentId),
  ]);

  return (
    <>
      <Nameplate desk={agent.persona.domain} agentId={agentId} active="wire" />

      <main className="mx-auto max-w-6xl px-5 pb-24 sm:px-8">
        {/* Publication head — who is filing, and what the wire is doing now. */}
        <div className="border-b border-rule py-10">
          <h1 className="display text-[clamp(2.5rem,7vw,4rem)]">
            {agent.persona.name}
          </h1>
          <p className="mt-3 max-w-[54ch] text-lg leading-relaxed text-graphite">
            {/* The old copy promised "every story below" on a page with none. */}
            {dispatches.length
              ? `Filing on ${agent.persona.domain}. Every story below was found, judged and written without a human in the loop.`
              : `Filing on ${agent.persona.domain}. The wire opens shortly — nothing has cleared the bar yet.`}
          </p>

          {/* Reader-facing counts only. Cycle count is telemetry and lives in
              the newsroom run log, where it means something. */}
          <dl className="mt-7 flex flex-wrap gap-x-8 gap-y-2">
            <Stat label="Filed" value={String(status.dispatchCount)} />
            <Stat label="Spiked" value={String(status.spikeCount)} />
            <Stat
              label="Last dispatch"
              value={status.lastPostAt ? ago(status.lastPostAt) : "—"}
            />
            <Stat
              label="Wire"
              value={status.lastTickAt ? `open · checked ${wireClock(status.lastTickAt)}` : "opening"}
            />
          </dl>
        </div>

        {dispatches.length === 0 ? (
          <p className="max-w-[52ch] py-16 text-lg leading-relaxed text-graphite">
            No dispatches yet. The editor files its first take on its next
            cycle, usually within fifteen minutes of initialization — it reads
            and spikes before it publishes.
          </p>
        ) : (
          <div className="pt-10">
            {dispatches.map((post, i) => (
              <Dispatch
                key={post.id}
                post={post}
                domain={agent.persona.domain}
                isLead={i === 0}
              />
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="wire text-graphite">{label}</dt>
      <dd className="wire mt-1 text-ink">{value}</dd>
    </div>
  );
}
