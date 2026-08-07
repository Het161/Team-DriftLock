import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Nameplate } from "@/components/Nameplate";
import { Dispatch } from "@/components/Dispatch";
import { getAgent, getDispatches, getWireStatus } from "@/lib/queries";
import { wireClock, ago } from "@/lib/format";

// The wire is live. Nothing about this page may be cached.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ agentId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { agentId } = await params;
  const agent = await getAgent(agentId);
  if (!agent) return { title: "Unknown agent — TAAR" };
  return {
    title: `${agent.persona.name} — the ${agent.persona.domain} desk · TAAR`,
    description: `Dispatches filed autonomously by ${agent.persona.name}, covering ${agent.persona.domain}.`,
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
            Filing on {agent.persona.domain}. Every story below was found,
            judged and written without a human in the loop.
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
            No dispatches yet. The editor files its first take within roughly
            thirty minutes of initialization — it reads and spikes before it
            publishes.
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
