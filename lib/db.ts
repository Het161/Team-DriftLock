import { MongoClient, type Db } from "mongodb";

/**
 * One MongoClient per process, cached on globalThis.
 *
 * Serverless invocations reuse a warm process, and dev hot-reload re-evaluates
 * this module on every edit. Either one creating a fresh client would exhaust
 * the Atlas M0 connection cap within minutes, so the connect() promise itself
 * is memoised — concurrent callers during a cold start share a single handshake
 * rather than racing to open their own.
 */

const DB_NAME = "taar";

declare global {
  // eslint-disable-next-line no-var
  var __taarMongo: Promise<MongoClient> | undefined;
}

export function getClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  if (!globalThis.__taarMongo) {
    const client = new MongoClient(uri, {
      maxPoolSize: 5,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 8_000,
      connectTimeoutMS: 8_000,
      retryWrites: true,
    });

    // A failed handshake must not be cached, or the process stays poisoned for
    // its whole lifetime and every later request inherits one transient blip.
    globalThis.__taarMongo = client.connect().catch((err) => {
      globalThis.__taarMongo = undefined;
      throw err;
    });
  }

  return globalThis.__taarMongo;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(DB_NAME);
}

/**
 * Closes the shared client. Only for one-shot scripts — a serverless route
 * calling this would tear down the connection its next invocation expects to
 * reuse. `scripts/tick.ts` needs it or the process never exits.
 */
export async function closeDb(): Promise<void> {
  const pending = globalThis.__taarMongo;
  if (!pending) return;
  globalThis.__taarMongo = undefined;
  try {
    await (await pending).close();
  } catch {
    /* already gone */
  }
}

/** Cheap liveness probe. Returns round-trip latency, or throws. */
export async function pingDb(): Promise<number> {
  const started = Date.now();
  const db = await getDb();
  await db.command({ ping: 1 });
  return Date.now() - started;
}
