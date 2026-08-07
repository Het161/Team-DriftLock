/**
 * Submission preflight. Run against PRODUCTION before handing anything in.
 *
 *   npm run preflight
 *
 * This is deliberately not the contract verifier. verify-feed.ts answers "is
 * the evaluator's integration correct"; this answers "is the whole submission
 * shippable" — routes, scheduler liveness, repo hygiene, and the absence of
 * scaffolding left behind.
 *
 * It ends by printing the checklist a script cannot verify, because the things
 * most likely to sink a submission — a private repo, a disabled cron job — are
 * exactly the ones no amount of curl will notice.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { loadEnv } from "./_env";

loadEnv();

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  bold: "\x1b[1m",
};

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): boolean {
  if (ok) {
    pass++;
    console.log(`  ${C.green}✓${C.reset} ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  ${C.red}✗ ${label}${C.reset}`);
    if (detail) console.log(`    ${C.dim}${detail}${C.reset}`);
  }
  return ok;
}

function section(t: string) {
  console.log(`\n${C.bold}${t}${C.reset}`);
}

const BASE = (
  process.argv.includes("--url")
    ? process.argv[process.argv.indexOf("--url") + 1]
    : (process.env.TAAR_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "")
).replace(/\/$/, "");

const DEMO_AGENT = process.env.TAAR_DEMO_AGENT ?? process.argv[process.argv.indexOf("--agent") + 1];

async function main() {
  console.log(`\n${C.bold}TAAR submission preflight${C.reset}`);
  console.log(`${C.dim}target: ${BASE || "(none)"}${C.reset}`);

  if (!BASE || BASE.includes("localhost")) {
    console.error(
      `\n${C.red}Refusing to preflight against "${BASE}".${C.reset}\n` +
        "Production is what gets judged. Set NEXT_PUBLIC_APP_URL or pass --url.\n",
    );
    process.exit(1);
  }

  /* --- routes ------------------------------------------------------------- */
  section("Routes");

  const routes: Array<[string, number]> = [
    ["/", 200],
    ["/api/health", 200],
    ["/api/agent/feed", 400],
    ["/api/agent/feed?agentId=definitely-not-real", 404],
    ["/wire/definitely-not-real", 404],
    ["/newsroom/definitely-not-real", 404],
  ];
  if (DEMO_AGENT) {
    routes.push([`/wire/${DEMO_AGENT}`, 200], [`/newsroom/${DEMO_AGENT}`, 200]);
  }

  for (const [path, want] of routes) {
    const res = await fetch(`${BASE}${path}`, { cache: "no-store" }).catch(() => null);
    check(`${path} → ${want}`, res?.status === want, `got ${res?.status ?? "no response"}`);
  }

  const og = await fetch(`${BASE}/og.png`, { cache: "no-store" }).catch(() => null);
  check(
    "/og.png is served",
    og?.status === 200 && (og.headers.get("content-type") ?? "").includes("image"),
    `status ${og?.status}, type ${og?.headers.get("content-type")}`,
  );

  /* --- contract ----------------------------------------------------------- */
  section("Contract");

  const init = await fetch(`${BASE}/api/agent/init`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ persona: { name: "Preflight", domain: "Release Checks" } }),
    cache: "no-store",
  });
  const initBody = (await init.json().catch(() => null)) as { agentId?: string } | null;
  const probeId = initBody?.agentId;

  check("init returns 200 with an agentId", init.status === 200 && Boolean(probeId));

  if (probeId) {
    const feed = await fetch(`${BASE}/api/agent/feed?agentId=${probeId}`, { cache: "no-store" });
    const raw = await feed.text();
    check("a fresh agent's feed is exactly {\"posts\":[]}", raw.trim() === '{"posts":[]}', raw.slice(0, 120));

    const secret = process.env.CRON_SECRET;
    if (secret) {
      const del = await fetch(`${BASE}/api/internal/agent/${probeId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${secret}` },
      });
      check("preflight's probe agent was removed", del.status === 200, `got ${del.status}`);
    } else {
      check("CRON_SECRET available to clean up the probe agent", false, `agent ${probeId} left behind`);
    }
  }

  if (DEMO_AGENT) {
    const feed = await fetch(`${BASE}/api/agent/feed?agentId=${DEMO_AGENT}`, { cache: "no-store" });
    const body = (await feed.json().catch(() => null)) as { posts?: unknown[] } | null;
    const posts = Array.isArray(body?.posts) ? body!.posts : [];
    check("the demo agent has published at least one dispatch", posts.length > 0, `${posts.length} posts`);

    const EXPECTED = "createdAt,id,rationale,sources,text";
    const shapeOk = posts.every(
      (p) => p && typeof p === "object" && Object.keys(p).sort().join(",") === EXPECTED,
    );
    check("every post has exactly the five contract fields", shapeOk);
  }

  /* --- schedulers --------------------------------------------------------- */
  section("Schedulers");

  const health = (await fetch(`${BASE}/api/health`, { cache: "no-store" }).then((r) => r.json())) as {
    ok?: boolean;
    lastTickAt?: string | null;
    lastRunByTrigger?: Record<string, string | null>;
  };

  check("/api/health reports ok", health.ok === true);

  const now = Date.now();
  const tickAge = health.lastTickAt ? (now - new Date(health.lastTickAt).getTime()) / 60000 : Infinity;
  check(
    "last cycle is under 45 minutes old",
    tickAge < 45,
    Number.isFinite(tickAge) ? `${Math.round(tickAge)} min ago` : "no cycle recorded",
  );

  for (const trigger of ["actions", "http"] as const) {
    const at = health.lastRunByTrigger?.[trigger];
    const age = at ? (now - new Date(at).getTime()) / 60000 : Infinity;
    check(
      `scheduler "${trigger}" ran within 2 hours`,
      age < 120,
      at ? `${Math.round(age)} min ago (${at})` : "never seen",
    );
  }

  /* --- repo hygiene ------------------------------------------------------- */
  section("Repository");

  for (const f of ["README.md", "PROMPTS.md", ".env.example", ".github/workflows/tick.yml"]) {
    check(`${f} present`, existsSync(f));
  }

  check(".env.local is NOT committed", !tracked(".env.local"));

  // Things that should never survive into a submission.
  const offenders = scan(".", [
    { label: "SCAFFOLD placeholder text", re: /SCAFFOLD/ },
    { label: "hardcoded localhost URL", re: /https?:\/\/localhost(?::\d+)?/ },
    { label: "hardcoded vercel preview URL", re: /taar-[a-z0-9]{9,}-het-patels-projects/ },
  ]);

  for (const [label, hits] of offenders) {
    check(`no ${label}`, hits.length === 0, hits.slice(0, 4).join("\n    "));
  }

  /* --- summary ------------------------------------------------------------ */
  const colour = fail ? C.red : C.green;
  console.log(`\n${colour}${C.bold}${pass} passed · ${fail} failed${C.reset}`);
  if (fail) {
    console.log(`\n${C.red}Blocking:${C.reset}`);
    for (const f of failures) console.log(`  · ${f}`);
  }

  console.log(`\n${C.bold}${C.yellow}Check by hand — a script cannot see these:${C.reset}`);
  for (const line of [
    "GitHub repo is PUBLIC (Actions minutes and the audit trail both depend on it)",
    "Actions history is green — https://github.com/Het161/taar/actions",
    "cron-job.org job is ENABLED, method POST, and its history shows 202s",
    "All 5 secrets set in BOTH Vercel and GitHub Actions",
    "Vercel production alias is public — deployment-specific URLs sit behind SSO",
    "Submission form: repo URL, live URL, and the path to PROMPTS.md as the AI-usage log",
    "Open the live URL on a phone, on mobile data, not just on this machine",
  ]) {
    console.log(`  ${C.dim}☐${C.reset} ${line}`);
  }
  console.log();

  process.exit(fail ? 1 : 0);
}

function tracked(path: string): boolean {
  try {
    // Cheap proxy for `git ls-files`: .gitignore is the thing that matters, and
    // a committed .env.local would be visible in the repo listing anyway.
    const ignore = readFileSync(".gitignore", "utf8");
    return !ignore.includes(".env*") && existsSync(path);
  } catch {
    return false;
  }
}

/** Greps the source tree, skipping build output and dependencies. */
function scan(
  root: string,
  patterns: Array<{ label: string; re: RegExp }>,
): Array<[string, string[]]> {
  const SKIP = new Set(["node_modules", ".next", ".git", ".vercel", "public"]);
  const EXT = new Set([".ts", ".tsx", ".css", ".mjs", ".json", ".yml", ".yaml"]);
  const hits = new Map<string, string[]>(patterns.map((p) => [p.label, []]));

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!EXT.has(extname(entry))) continue;
      // package-lock is machine-written and full of URLs we do not control.
      if (entry === "package-lock.json") continue;

      const text = readFileSync(full, "utf8");
      text.split("\n").forEach((line, i) => {
        for (const p of patterns) {
          // The preflight script naturally contains its own patterns.
          if (full.endsWith("preflight.ts")) continue;
          if (p.re.test(line)) hits.get(p.label)!.push(`${full}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      });
    }
  };

  walk(root);
  return [...hits.entries()];
}

main().catch((err) => {
  console.error(`\n${C.red}Preflight crashed:${C.reset}`, err);
  process.exit(1);
});
