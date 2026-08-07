/**
 * The brain, run on a schedule.
 *
 *   npx tsx scripts/tick.ts
 *
 * Executed by .github/workflows/tick.yml every 30 minutes. It talks straight to
 * Mongo, the model providers, Breeth and the news sources — Vercel is not in
 * this path at all, which is what keeps TAAR free of serverless timeouts and
 * leaves the deployment responsible only for serving the feed.
 */

import { loadEnv } from "./_env";

loadEnv();

import { runTick } from "../lib/tick";
import { closeDb } from "../lib/db";

async function main(): Promise<void> {
  const trigger = process.argv.includes("--manual") ? "manual" : "actions";
  const startedAt = Date.now();

  console.log(`taar tick · trigger=${trigger} · ${new Date().toISOString()}`);

  const report = await runTick({ trigger });

  if (report.locked) {
    console.log("lease held by another run — exiting without doing anything.");
    return;
  }

  console.log(
    `provider=${report.preferredProvider} · agents=${report.agentsConsidered} · llm calls=${report.llmCalls}`,
  );

  for (const s of report.summaries) {
    console.log(`\n  ${s.persona} [${s.agentId.slice(0, 8)}] → ${s.outcome.toUpperCase()}`);
    console.log(
      `    found ${s.candidatesFound} · fresh ${s.candidatesAfterDedupe} · spiked ${s.spiked} · published ${s.published}`,
    );
    for (const note of s.notes) console.log(`    · ${note}`);
    if (s.postId) console.log(`    post id: ${s.postId}`);
    if (s.error) console.log(`    ERROR: ${s.error}`);
  }

  console.log(`\ndone in ${Date.now() - startedAt}ms`);

  // Surfaces a genuine failure in the Actions run history rather than burying
  // it in a green checkmark. Quiet cycles and dead adapters are not failures.
  if (report.summaries.some((s) => s.outcome === "error")) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("tick failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
