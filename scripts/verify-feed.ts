/**
 * Contract verifier. Run after every deploy.
 *
 *   npx tsx scripts/verify-feed.ts                  # against $NEXT_PUBLIC_APP_URL
 *   npx tsx scripts/verify-feed.ts --url https://…  # against anything else
 *   npx tsx scripts/verify-feed.ts --agent <id>     # also shape-check a live feed
 *
 * This asserts the evaluator's contract against the DEPLOYED URL, not localhost.
 * A green local run proves nothing: the evaluator only ever sees production.
 *
 * Exit code 0 = every assertion passed. 1 = at least one failed.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadEnv } from "./_env";

loadEnv();

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  bold: "\x1b[1m",
};

let passed = 0;
let failed = 0;
let skipped = 0;
let warned = 0;
const failures: string[] = [];
const warnings: string[] = [];

function check(label: string, condition: boolean, detail?: string): boolean {
  if (condition) {
    passed++;
    console.log(`  ${C.green}✓${C.reset} ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ${C.red}✗ ${label}${C.reset}`);
    if (detail) console.log(`    ${C.dim}${detail}${C.reset}`);
  }
  return condition;
}

function skip(label: string, why: string): void {
  skipped++;
  console.log(`  ${C.yellow}–${C.reset} ${C.dim}${label} — ${why}${C.reset}`);
}

/**
 * A warning, not a failure.
 *
 * Scheduler liveness is operational health, not contract compliance. A stalled
 * pinger is worth shouting about, but it must not turn the contract suite red —
 * that suite's exit code is what tells us whether the evaluator's integration
 * is broken, and conflating the two would train us to ignore a red run.
 */
function warn(label: string, why: string): void {
  warned++;
  warnings.push(`${label} — ${why}`);
  console.log(`  ${C.yellow}!${C.reset} ${label} ${C.dim}— ${why}${C.reset}`);
}

function section(title: string): void {
  console.log(`\n${C.bold}${title}${C.reset}`);
}

/* -------------------------------------------------------------------------- */
/* Config                                                                      */
/* -------------------------------------------------------------------------- */

const argv = process.argv.slice(2);
function arg(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

const BASE = (
  arg("--url") ??
  process.env.TAAR_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  ""
).replace(/\/$/, "");

if (!BASE) {
  console.error("No target URL. Set NEXT_PUBLIC_APP_URL or pass --url.");
  process.exit(1);
}
if (BASE.includes("localhost") && !argv.includes("--allow-local")) {
  console.error(
    `Refusing to verify against ${BASE}.\n` +
      "Production is the source of truth; pass --allow-local to override.",
  );
  process.exit(1);
}

const SNAPSHOT_FILE = ".taar-verify-snapshot.json";
const CRON_SECRET = process.env.CRON_SECRET;

type Res = {
  status: number;
  contentType: string;
  cacheControl: string;
  body: unknown;
  raw: string;
};

async function req(
  path: string,
  init?: RequestInit & { rawBody?: string },
): Promise<Res> {
  const { rawBody, ...rest } = init ?? {};
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    ...(rawBody !== undefined ? { body: rawBody } : {}),
    cache: "no-store",
  });
  const raw = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    /* left null — callers assert on it */
  }
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    cacheControl: res.headers.get("cache-control") ?? "",
    body,
    raw,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/* -------------------------------------------------------------------------- */
/* Run                                                                         */
/* -------------------------------------------------------------------------- */

async function main() {
  console.log(`\n${C.bold}TAAR contract verification${C.reset}`);
  console.log(`${C.dim}target: ${BASE}${C.reset}`);

  /* --- init: happy path -------------------------------------------------- */
  section("POST /api/agent/init");

  const initRes = await req("/api/agent/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    rawBody: JSON.stringify({
      persona: { name: "Verifier Probe", domain: "Contract Testing" },
    }),
  });

  check("returns 200", initRes.status === 200, `got ${initRes.status}: ${initRes.raw.slice(0, 200)}`);
  check("responds with JSON", initRes.contentType.includes("application/json"), initRes.contentType);

  const agentId = isObj(initRes.body) ? initRes.body.agentId : undefined;
  check(
    "body is { agentId: string }",
    typeof agentId === "string" && agentId.length > 0,
    `got ${JSON.stringify(initRes.body)}`,
  );
  if (isObj(initRes.body)) {
    check(
      "body carries no unexpected top-level keys",
      Object.keys(initRes.body).join(",") === "agentId",
      `keys: ${Object.keys(initRes.body).join(", ")}`,
    );
  }

  /* --- init: rejection cases --------------------------------------------- */
  section("POST /api/agent/init — malformed input");

  const badBodies: Array<[string, string]> = [
    ["missing persona", JSON.stringify({})],
    ["persona not an object", JSON.stringify({ persona: "Ada" })],
    ["missing domain", JSON.stringify({ persona: { name: "Ada" } })],
    ["empty name", JSON.stringify({ persona: { name: "  ", domain: "AI" } })],
    ["non-string domain", JSON.stringify({ persona: { name: "Ada", domain: 7 } })],
    ["not JSON at all", "this is not json"],
  ];

  for (const [label, rawBody] of badBodies) {
    const r = await req("/api/agent/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      rawBody,
    });
    check(`${label} → 400`, r.status === 400, `got ${r.status}: ${r.raw.slice(0, 160)}`);
    check(
      `${label} → JSON error body`,
      r.contentType.includes("application/json") && isObj(r.body) && "error" in r.body,
      r.raw.slice(0, 160),
    );
  }

  /* --- feed: edge cases --------------------------------------------------- */
  section("GET /api/agent/feed — edge cases");

  const noParam = await req("/api/agent/feed");
  check("missing agentId → 400", noParam.status === 400, `got ${noParam.status}`);
  check(
    "missing agentId → JSON error body",
    noParam.contentType.includes("application/json") &&
      isObj(noParam.body) &&
      "error" in noParam.body,
    noParam.raw.slice(0, 160),
  );

  const emptyParam = await req("/api/agent/feed?agentId=");
  check("blank agentId → 400", emptyParam.status === 400, `got ${emptyParam.status}`);

  const unknown = await req(
    "/api/agent/feed?agentId=00000000-0000-4000-8000-000000000000",
  );
  check("unknown agentId → 404", unknown.status === 404, `got ${unknown.status}`);
  check(
    "unknown agentId → JSON error body",
    unknown.contentType.includes("application/json") &&
      isObj(unknown.body) &&
      "error" in unknown.body,
    unknown.raw.slice(0, 160),
  );

  /* --- feed: freshly created agent ---------------------------------------- */
  section("GET /api/agent/feed — agent with no dispatches");

  if (typeof agentId !== "string") {
    skip("empty-feed checks", "init did not return an agentId");
  } else {
    const fresh = await req(`/api/agent/feed?agentId=${encodeURIComponent(agentId)}`);
    check("returns 200", fresh.status === 200, `got ${fresh.status}`);
    check(
      'body is exactly {"posts":[]}',
      isObj(fresh.body) &&
        Object.keys(fresh.body).join(",") === "posts" &&
        Array.isArray(fresh.body.posts) &&
        fresh.body.posts.length === 0,
      fresh.raw.slice(0, 200),
    );
    check(
      "is not cached downstream",
      /no-store/.test(fresh.cacheControl),
      `cache-control was "${fresh.cacheControl}" — without no-store the evaluator can be served a stale feed`,
    );
  }

  /* --- feed: shape of a populated feed ------------------------------------ */
  section("GET /api/agent/feed — populated feed");

  const targetAgent = arg("--agent") ?? process.env.TAAR_DEMO_AGENT;

  if (!targetAgent) {
    skip("populated-feed checks", "no --agent / TAAR_DEMO_AGENT given");
  } else {
    const feed = await req(`/api/agent/feed?agentId=${encodeURIComponent(targetAgent)}`);
    check("returns 200", feed.status === 200, `got ${feed.status}: ${feed.raw.slice(0, 160)}`);

    const posts =
      isObj(feed.body) && Array.isArray(feed.body.posts)
        ? (feed.body.posts as unknown[])
        : null;

    if (!posts) {
      check("body has a posts array", false, feed.raw.slice(0, 200));
    } else if (posts.length === 0) {
      skip("post shape checks", "agent has filed no dispatches yet");
    } else {
      console.log(`  ${C.dim}${posts.length} dispatch(es) on the wire${C.reset}`);

      const EXPECTED = "createdAt,id,rationale,sources,text";
      const wrongShape = posts.filter(
        (p) => !isObj(p) || Object.keys(p).sort().join(",") !== EXPECTED,
      );
      check(
        "every post has exactly the five contract fields",
        wrongShape.length === 0,
        wrongShape[0] ? `first offender: ${JSON.stringify(wrongShape[0]).slice(0, 220)}` : "",
      );

      const p = posts as Array<Record<string, unknown>>;

      const ids = p.map((x) => x.id);
      check(
        "every id is a non-empty string",
        ids.every((i) => typeof i === "string" && i.length > 0),
      );
      check(
        "ids are unique",
        new Set(ids).size === ids.length,
        `${ids.length} posts, ${new Set(ids).size} distinct ids`,
      );

      const badTs = p.filter((x) => {
        const t = x.createdAt;
        if (typeof t !== "string" || !t.endsWith("Z")) return true;
        const d = new Date(t);
        return Number.isNaN(d.getTime()) || d.toISOString() !== t;
      });
      check(
        "every createdAt is ISO-8601 UTC and round-trips",
        badTs.length === 0,
        badTs[0] ? `first offender: ${String(badTs[0].createdAt)}` : "",
      );

      const times = p.map((x) => new Date(String(x.createdAt)).getTime());
      const ordered = times.every((t, i) => i === 0 || times[i - 1] >= t);
      check("ordered newest first", ordered, times.join(" → "));

      check(
        "every text is substantive",
        p.every((x) => typeof x.text === "string" && x.text.trim().length > 40),
      );
      check(
        "every rationale is present",
        p.every((x) => typeof x.rationale === "string" && x.rationale.trim().length > 20),
      );

      const badSources = p.filter(
        (x) =>
          !Array.isArray(x.sources) ||
          x.sources.some((s) => typeof s !== "string" || !/^https?:\/\//.test(s)),
      );
      check(
        "every sources entry is an http(s) URL",
        badSources.length === 0,
        badSources[0] ? `first offender: ${JSON.stringify(badSources[0].sources)}` : "",
      );

      /* --- persistence across runs ---------------------------------------- */
      section("Persistence — posts returned once are returned forever");

      type Snapshot = Record<string, string[]>;
      const snapshot: Snapshot = existsSync(SNAPSHOT_FILE)
        ? JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8"))
        : {};

      const seenBefore = snapshot[targetAgent] ?? [];
      const nowIds = new Set(ids.map(String));

      if (seenBefore.length === 0) {
        skip("historical comparison", "first run — recording a baseline");
      } else {
        const vanished = seenBefore.filter((i) => !nowIds.has(i));
        check(
          `all ${seenBefore.length} previously seen post(s) still present`,
          vanished.length === 0,
          vanished.length ? `missing: ${vanished.join(", ")}` : "",
        );
      }

      snapshot[targetAgent] = [...new Set([...seenBefore, ...ids.map(String)])];
      writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
      console.log(
        `  ${C.dim}baseline now ${snapshot[targetAgent].length} id(s) in ${SNAPSHOT_FILE}${C.reset}`,
      );
    }
  }

  /* --- scheduler liveness -------------------------------------------------- */
  section("Schedulers");

  const health = await req("/api/health");
  const healthBody = isObj(health.body) ? health.body : null;

  check("/api/health responds", health.status === 200, `got ${health.status}`);

  if (healthBody) {
    const byTrigger = isObj(healthBody.lastRunByTrigger)
      ? (healthBody.lastRunByTrigger as Record<string, unknown>)
      : {};

    // Both schedulers run permanently and in parallel — Actions at 9,39 and the
    // external pinger at 24,54, interleaved so a dead line is covered within
    // ~15 minutes. Two hours is therefore several missed cycles, not a blip.
    const STALE_MS = 2 * 60 * 60 * 1000;
    const now = Date.now();

    for (const trigger of ["actions", "http"] as const) {
      const at = byTrigger[trigger];
      if (typeof at !== "string") {
        warn(`scheduler "${trigger}"`, "has never run");
        continue;
      }
      const age = now - new Date(at).getTime();
      if (!Number.isFinite(age) || age > STALE_MS) {
        warn(
          `scheduler "${trigger}"`,
          `last ran ${Math.round(age / 60000)} min ago (${at})`,
        );
      } else {
        check(`scheduler "${trigger}" ran within 2h`, true);
        console.log(`    ${C.dim}last: ${at}${C.reset}`);
      }
    }

    const lastTickAt = healthBody.lastTickAt;
    if (typeof lastTickAt === "string") {
      const mins = Math.round((now - new Date(lastTickAt).getTime()) / 60000);
      console.log(`  ${C.dim}last cycle of any kind: ${mins} min ago${C.reset}`);
    }
  }

  /* --- cleanup ------------------------------------------------------------ */
  section("Cleanup");

  if (typeof agentId !== "string") {
    skip("probe agent removal", "nothing was created");
  } else if (!CRON_SECRET) {
    skip("probe agent removal", `CRON_SECRET not set — agent ${agentId} left behind`);
  } else {
    const del = await req(`/api/internal/agent/${agentId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    check("probe agent removed", del.status === 200, `got ${del.status}: ${del.raw.slice(0, 160)}`);
  }

  /* --- summary ------------------------------------------------------------ */
  const colour = failed ? C.red : C.green;
  console.log(
    `\n${colour}${C.bold}${passed} passed · ${failed} failed · ${skipped} skipped · ${warned} warning(s)${C.reset}\n`,
  );
  if (failed) {
    console.log(`${C.red}Failed assertions:${C.reset}`);
    for (const f of failures) console.log(`  · ${f}`);
    console.log();
  }
  if (warned) {
    console.log(`${C.yellow}Warnings (operational, not contract):${C.reset}`);
    for (const w of warnings) console.log(`  · ${w}`);
    console.log();
  }
  // Warnings deliberately do not affect the exit code. See warn().
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n${C.red}Verifier crashed:${C.reset}`, err);
  process.exit(1);
});
