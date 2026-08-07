import type { Charter } from "./schema";

/**
 * When the editor is allowed to file.
 *
 * A tick runs every 30 minutes, but publishing every 30 minutes would produce
 * 96 dispatches a day, exhaust the LLM budget by mid-morning, and read like a
 * scraper rather than a correspondent. So most cycles are deliberately quiet:
 * the editor still discovers and still spikes — editorial life continues and
 * the spike log keeps growing — it just does not publish.
 */

export type CadenceDecision = {
  mayPublish: boolean;
  /** Human-readable, and shown in the newsroom run log. */
  reason: string;
  postsToday: number;
  target: number;
  minutesSinceLastPost: number | null;
  requiredGapMinutes: number;
};

export function decideCadence(input: {
  charter: Charter;
  lastPostAt: string | null;
  postsToday: number;
  agentId: string;
  now?: Date;
}): CadenceDecision {
  const now = input.now ?? new Date();
  const { postsPerDay, minGapMinutes } = input.charter.cadence;

  // Jitter so filing times look like a person's day rather than a cron table.
  // Derived from the agent id and the post index, so it is stable within a
  // cycle — a random value would let a retry publish early purely by luck.
  const requiredGap =
    minGapMinutes + jitter(`${input.agentId}:${dayKey(now)}:${input.postsToday}`, 10);

  const minutesSince =
    input.lastPostAt === null
      ? null
      : (now.getTime() - new Date(input.lastPostAt).getTime()) / 60_000;

  const base = {
    postsToday: input.postsToday,
    target: postsPerDay,
    minutesSinceLastPost: minutesSince === null ? null : Math.round(minutesSince),
    requiredGapMinutes: requiredGap,
  };

  if (input.postsToday >= postsPerDay) {
    return {
      ...base,
      mayPublish: false,
      reason: `Daily target met (${input.postsToday}/${postsPerDay}). Reading, not filing.`,
    };
  }

  if (minutesSince !== null && minutesSince < requiredGap) {
    return {
      ...base,
      mayPublish: false,
      reason: `Filed ${Math.round(minutesSince)} min ago; next window opens at ${requiredGap} min.`,
    };
  }

  return {
    ...base,
    mayPublish: true,
    reason:
      minutesSince === null
        ? "First dispatch — the wire is open."
        : `${Math.round(minutesSince)} min since the last dispatch. Window is open.`,
  };
}

/** UTC day key, so "posts today" means the same thing wherever a runner sits. */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Deterministic FNV-1a derived offset in [-spread, +spread]. */
function jitter(seed: string, spread: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % (spread * 2 + 1)) - spread;
}
