import { loadEnv } from "./scripts/_env";
loadEnv();
import { agents } from "./lib/schema";
import { closeDb } from "./lib/db";

const ID = "00000000-empty-state-probe-0000";

async function main() {
  const col = await agents();
  const mode = process.argv[2];
  if (mode === "create") {
    await col.deleteOne({ agentId: ID });
    await col.insertOne({
      agentId: ID,
      persona: { name: "Probe", domain: "Empty States" },
      charter: null,
      charterStatus: "pending",
      // paused: the roster filters on status:"active", so the tick will not
      // touch this and it costs no LLM calls.
      status: "paused",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastPostAt: null,
      postCount: 0,
    });
    console.log("created paused probe agent:", ID);
  } else {
    const r = await col.deleteOne({ agentId: ID });
    console.log("deleted probe agent:", r.deletedCount);
  }
}
main().catch(console.error).finally(async () => { await closeDb(); });
