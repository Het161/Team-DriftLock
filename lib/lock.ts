import { randomUUID } from "node:crypto";
import { locks } from "./schema";

/**
 * A Mongo lease, so two schedulers can never publish twice for the same cycle.
 *
 * TAAR is deliberately triggered from two places — a GitHub Actions cron and an
 * optional external pinger hitting POST /api/agent/tick — because a single free
 * scheduler that silently stops is the most likely way this project dies during
 * a 48-hour evaluation. Redundant triggers are only safe if overlapping runs are
 * impossible, which is this file's whole job.
 */

export const TICK_LOCK = "tick";

export type Lease = { id: string; holder: string; expiresAt: Date };

/**
 * Returns a lease, or null if someone else holds a live one.
 *
 * The filter matches only an expired (or absent) lock, and `upsert` turns a
 * non-match into an insert. If a live lock exists the filter misses, the upsert
 * tries to insert a second document with the same _id, and Mongo raises a
 * duplicate key error — which is the atomic "someone else won" signal. Doing it
 * in one round trip is what makes it safe; a read-then-write would race.
 */
export async function acquireLease(
  id: string = TICK_LOCK,
  ttlMs = 8 * 60_000,
): Promise<Lease | null> {
  const col = await locks();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const holder = randomUUID();

  try {
    await col.updateOne(
      { _id: id, expiresAt: { $lte: now } },
      { $set: { holder, acquiredAt: now, expiresAt } },
      { upsert: true },
    );
    return { id, holder, expiresAt };
  } catch (err) {
    if (isDuplicateKey(err)) return null;
    throw err;
  }
}

/**
 * Releases only if we still hold it. A tick that overran its TTL has already
 * had the lease reaped and possibly re-taken; deleting by id alone would then
 * cancel someone else's run.
 */
export async function releaseLease(lease: Lease): Promise<void> {
  const col = await locks();
  await col.deleteOne({ _id: lease.id, holder: lease.holder });
}

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === 11000
  );
}
