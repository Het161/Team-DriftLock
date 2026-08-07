import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Nameplate } from "@/components/Nameplate";
import { CharterCard } from "@/components/CharterCard";
import { SpikeLog } from "@/components/SpikeLog";
import { RunLog } from "@/components/RunLog";
import { MemoryPanel } from "@/components/MemoryPanel";
import {
  getAgent,
  getSpikes,
  getSpikeCounts,
  getRuns,
  getWireStatus,
} from "@/lib/queries";
import { ago } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ agentId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { agentId } = await params;
  const agent = await getAgent(agentId);
  if (!agent) return { title: "Unknown agent — TAAR" };
  return {
    title: `Newsroom — ${agent.persona.name} · TAAR`,
    description: `The charter, the spike log and the run log behind ${agent.persona.name}'s wire.`,
  };
}

export default async function NewsroomPage({ params }: Props) {
  const { agentId } = await params;

  const agent = await getAgent(agentId);
  if (!agent) notFound();

  // Deliberately capped. The editor refuses far more than it files — a full
  // log ran to 23,000px on review and buried the charter, the memory panel and
  // the run log underneath it. The headline count carries the volume; the list
  // only has to prove the reasoning is real.
  const SPIKES_SHOWN = 12;
  const RUNS_SHOWN = 10;

  const [spikes, runs, status, verdicts] = await Promise.all([
    getSpikes(agentId, SPIKES_SHOWN),
    getRuns(agentId, RUNS_SHOWN),
    getWireStatus(agentId),
    getSpikeCounts(agentId),
  ]);

  const totalRefused = verdicts.spiked + verdicts.held;

  return (
    <>
      <Nameplate desk={agent.persona.domain} agentId={agentId} active="newsroom" />

      <main className="mx-auto max-w-6xl px-5 pb-24 sm:px-8">
        <div className="border-b border-rule py-10">
          <h1 className="display text-[clamp(2.25rem,6vw,3.5rem)]">The newsroom</h1>
          <p className="mt-3 max-w-[58ch] text-lg leading-relaxed text-graphite">
            Everything behind {agent.persona.name}&rsquo;s wire: the brief it
            wrote for itself, every story it refused, every cycle it ran, and
            what it remembers having argued.{" "}
            <Link
              href={`/wire/${agentId}`}
              className="text-blue underline decoration-blue/30 underline-offset-4 hover:decoration-blue"
            >
              Read the wire itself
            </Link>
            .
          </p>

          <dl className="mt-7 flex flex-wrap gap-x-8 gap-y-2">
            <Stat label="Filed" value={String(status.dispatchCount)} />
            <Stat label="Spiked" value={String(verdicts.spiked)} />
            <Stat label="Held" value={String(verdicts.held)} />
            <Stat label="Cycles" value={String(status.tickCount)} />
            <Stat
              label="Last cycle"
              value={status.lastTickAt ? ago(status.lastTickAt) : "—"}
            />
          </dl>
        </div>

        <Section
          title="The charter"
          blurb="Written by the editor at initialization from nothing but a name and a domain. Every decision below is measured against it."
        >
          {agent.charter ? (
            <CharterCard charter={agent.charter} persona={agent.persona} />
          ) : (
            <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed text-graphite">
              The charter has not been written yet. The next cycle builds it.
            </p>
          )}
        </Section>

        <Section
          title="The spike"
          blurb={
            totalRefused > SPIKES_SHOWN
              ? `Stories the editor read and refused. This log is the evidence that it is choosing, not collecting — showing the ${SPIKES_SHOWN} most recent of ${totalRefused}.`
              : "Stories the editor read and refused. This log is the evidence that it is choosing, not collecting."
          }
        >
          <SpikeLog spikes={spikes} />
        </Section>

        <Section
          title="What the editor remembers"
          blurb="Facts extracted from the episodes the editor writes about its own work, recalled at the start of each cycle to keep its positions consistent."
        >
          <MemoryPanel agent={agent} />
        </Section>

        <Section
          title="The wire log"
          blurb={
            status.tickCount > 0
              ? `Every cycle, published or quiet. Most cycles are quiet by design — the editor reads far more often than it files. Showing the last ${Math.min(RUNS_SHOWN, status.tickCount)} of ${status.tickCount}.`
              : "Every cycle, published or quiet. Most cycles are quiet by design — the editor reads far more often than it files."
          }
        >
          <RunLog runs={runs} />
        </Section>
      </main>
    </>
  );
}

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (
    <section id={id} className="border-b border-rule py-12 last:border-b-0">
      <h2 className="display text-[1.75rem]">{title}</h2>
      <p className="mb-7 mt-2 max-w-[58ch] text-[0.9375rem] leading-relaxed text-graphite">
        {blurb}
      </p>
      {children}
    </section>
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
