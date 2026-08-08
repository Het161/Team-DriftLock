# PROMPTS.md

A running log of how TAAR was actually built. Every working session appends an
entry: the prompt that drove it, what the model produced, and what a human had
to correct. This file is the audit trail — it is meant to be read alongside
`git log`, where the same sessions appear as commits.

Format per entry: **Prompt → Produced → Corrected**.

## Index

| # | Phase | What was steered | What it caught or fixed | Commits |
| --- | --- | --- | --- | --- |
| [001](#001--project-brief-and-architecture-lock) | Brief & scaffold | Product, contract, locked architecture, design system; plan-then-build loop | Scaffold refused the folder name; Atlas URI pointed at another database; `.gitignore` swallowed `.env.example`; dark mode deleted rather than themed | `1759576`, `3486168` |
| [002](#002--steps-13--deploy-database-and-the-contract) | Deploy + contract | Production-first: every gate asserted against the live URL, never localhost | **Vercel Auth would have hidden the product from the evaluator** — found by curling, not by opening a signed-in browser; the verifier would have poisoned the LLM budget with probe agents; the five-field rule made structural instead of careful | `2b02458`, `159964c`, `6595144` |
| [003](#003--step-4--the-tick) | The tick | Discovery, editorial gate, writer, memory, both triggers, the run lock | **The spec's Gemini fallback was dead**; Breeth is a graph, so terse episodes are unrecallable (1 entity/0 edges → 8/6); a 48h window silently deleted arXiv; Google News links are unpublishable; the first desk was 5/8 the same story; **the first dispatch invented a publishing history** | `99cee10`, `356ba10`, `3680e65`, `d94828d` |
| [004](#004--step-6--the-three-pages) | The three pages | Build order, screenshot at 390px + desktop, self-critique against tokens | Dateline rendered as the letter `T`, then lost its timestamp at 390px; the newsroom ran to 23,000px; **Breeth's metadata contradicts its own facts**, so it was cut; a CSS layering bug made the run log ALL CAPS; a `box-shadow` slipped into a shadow-free system | `1692a62`, `0214d89`, `5bbbb53`, `10ea522` |
| [005](#005--phase-7-priorities-01--redundancy-and-proof) | Redundancy & proof | Two schedulers running permanently in parallel; keep the claims separate | **The pinger would have failed on every run** (30.6s work vs a 30s timeout) → 202 + `after()`; a GET would have 405'd; two deploys failed on lint because I checked with `tsc`, not `build`; **I reported a deploy failure that never happened**, and **called GitHub's scheduler dead when it was 19 minutes late** | `f279a2f`, `b4fffc1`, `fe6ba5a`, `302a0d7`, `c94b258`, `036ec86` |
| [006](#006--the-overnight-silence) | The overnight silence | "check all things now" — every mechanical check green, product still failed | **A `hold` is not a refusal, but dedupe treated it as one.** The editor permanently burned its own candidate pool and went silent 9½ hours. Holds now return after a cooldown — and the very story it then filed was one it had held at 60 | `e434fdd`, `e346f07` |
| [007](#007--the-second-agent-and-four-provider-failures-behind-it) | Second publication | Stand up a second editor; prove persona-agnosticism by voice | **The Gemini fallback had never worked** — pinned to `v1` off a probe that tested the wrong call; **tokens, not requests, were the ceiling**, and my "7× headroom" report was wrong; the cheap frequent task was starving the rare expensive one; a never-published agent could never be in "drought" | `5c0ebea`, `5a00e33`, `af333fe` |
| [008](#008--lockdown--secrets-the-last-two-tests-and-the-budget) | Lockdown | Secrets, last two tests, measured budget, then **freeze** | Secret audit clean across all history; the hygiene scan couldn't see Markdown — the file most likely to leak; **the rotation list was missing the database password**; charter recovery proven both halves; the budget guard I'd just added watched the wrong bucket | `700b6a8`, `2fd89eb`, `0b83c4b`, `5ab4233`, `20fa139` |

**If you read one thing:** [006](#006--the-overnight-silence) — a failure where
every check was green, nothing had crashed, and the system was working exactly
as written. What was written was wrong.

---

## 001 · Project brief and architecture lock

**Date:** 2026-08-07
**Tool:** Claude Code (Opus 5) in VS Code

### Prompt

A single mega-prompt establishing the whole project. Abridged, the operative
parts were:

> You are the lead engineer AND design lead for a 48-hour hackathon build […]
> Work in a plan → confirm → build loop. Before writing code for any major
> phase, show me a short plan and wait for my go-ahead.
>
> **Product:** TAAR — an autonomous wire service run by a single AI editor.
> Once initialized with a persona, it discovers stories from live sources,
> decides what deserves publication, spikes what doesn't (with reasons), writes
> dispatches in a consistent editorial voice, remembers everything it has
> published, and keeps filing new takes for days — with zero human input.
>
> **Contract:** `POST /api/agent/init` takes `{persona:{name,domain}}` and
> returns `{agentId}`. `GET /api/agent/feed?agentId=…` returns
> `{posts:[{id,createdAt,text,rationale,sources}]}`, reverse-chronological,
> stable ids, ISO-8601 UTC, posts persist forever, exactly those five fields,
> `{"posts":[]}` when empty, 400 on missing param, 404 on unknown agent.
>
> **Architecture (locked):** Next.js 15 App Router + TypeScript + Tailwind v4 on
> Vercel Hobby; MongoDB Atlas M0 for state; the brain is `scripts/tick.ts` run by
> a **GitHub Actions cron every 30 minutes** (not Vercel Cron — Hobby only allows
> daily); a `CRON_SECRET`-protected `POST /api/agent/tick` as a backup trigger;
> a Mongo lease lock so overlapping schedulers can never double-post; Groq
> `llama-3.3-70b-versatile` primary with Gemini flash fallback and a per-tick
> call budget; Breeth REST for memory, failing open.
>
> **Design system:** refuse the three 2026 AI-design defaults. Paper `#F6F5F1`,
> ink `#1A1915`, blue-pencil `#2743C7` as the only accent, stamp-red `#C63B21`
> reserved exclusively for SPIKED stamps, graphite, rule. Newsreader / Schibsted
> Grotesk / Fragment Mono. 2px radius, zero shadows. The signature is the
> rationale rendered as **blue-pencil marginalia** in the dispatch margin, and
> red rubber-stamp SPIKED marks in the newsroom.
>
> **First task:** present an execution plan for checklist steps 1–3 (scaffold →
> deploy → contract endpoints + verifier) with the exact file tree. Wait for
> confirmation before scaffolding.

### Produced

- An inspection of the target directory before any planning, which surfaced two
  facts that changed the plan: the hackathon folder sits *inside* an unrelated
  git repo (`Desktop` → `Final_wagon.git`) with a large dirty working tree, and
  both `gh` and `vercel` CLIs were already authenticated.
- A three-phase plan with an explicit verification gate per phase, each gate
  asserted against the production URL rather than localhost.
- A narrowed file tree: only the files phases 1–3 actually need, with the
  `llm` / `breeth` / `discovery` / `editor` / `writer` / `cadence` / `lock`
  modules explicitly deferred rather than created as empty stubs.
- Phase 1 itself: Next.js 15.5 + React 19 + Tailwind v4 scaffold, the full token
  system in `app/globals.css`, the three typefaces wired through `next/font`,
  a placeholder front page, and env plumbing.

### Corrected

- **`create-next-app` refused the directory name.** `ABTalks-Hackathon` contains
  capitals, which npm rejects as a package name. Scaffolded into a `taar/`
  subdirectory and flattened it into the repo root so the package is named
  `taar` while the folder keeps its name.
- **Database name collision.** The supplied Atlas URI pointed at an existing
  `kora` database. Repointed to a `taar` database on the same cluster, and the
  app names the database explicitly in code rather than trusting the URI path.
- **`.gitignore` swallowed `.env.example`.** The Next default ignores `.env*`,
  which would have hidden a file that needs to be committed. Added
  `!.env.example`.
- **Dark mode deleted, not themed.** The scaffold ships a
  `prefers-color-scheme: dark` block. A wire service prints on paper; the
  product is light-only by decision, so the block was removed rather than
  given a dark palette.

---

## 002 · Steps 1–3 — deploy, database, and the contract

**Date:** 2026-08-07
**Tool:** Claude Code (Opus 5) in VS Code

### Prompt

Approval to execute the phase 1–3 plan, plus the four service credentials
(Atlas, Groq, Gemini, Breeth) and the repo name `taar`. The standing instruction
from entry 001 governed the work: *production-first — the deployed Vercel URL is
the source of truth, not localhost; after every milestone we verify against the
live URL with curl.*

### Produced

- **Phase 1.** Scaffold, token system, three typefaces, first production deploy
  to https://taar-psi.vercel.app, verified by fetching the deployed stylesheet
  and grepping it for `#f6f5f1` / `#2743c7` / `#c63b21`.
- **Phase 2.** `lib/db.ts` (memoised connect promise), `lib/schema.ts` (five
  document types, the `Charter` type, index construction), `/api/health`.
  Verified `db:"up"` from the deployment, which is what actually proves Atlas
  network access allows Vercel — a local ping does not.
- **Phase 3.** `/api/agent/init`, `/api/agent/feed`, `/api/internal/agent/[id]`,
  `lib/contract.ts`, and `scripts/verify-feed.ts`. **25 assertions, 0 failures,
  against production.**

### Corrected

- **Vercel Authentication would have hidden the product from the evaluator.**
  The deployment-specific and team-scoped URLs (`taar-3t36…vercel.app`,
  `taar-het-patels-projects-…vercel.app`) both 302 to `vercel.com/login`. Caught
  by curling the URL instead of opening it in an already-authenticated browser,
  which would have shown a working page and hidden the problem completely. The
  production alias `taar-psi.vercel.app` is public, so that is the URL the
  evaluator gets and the only one anything is verified against.
- **`taar.vercel.app` belongs to somebody else** (a translation product), hence
  the `-psi` suffix Vercel assigned. Worth knowing before it gets written into a
  slide.
- **The verifier was going to poison the LLM budget.** It calls init on every
  run, and the tick is specified to publish for *every* active agent — so each
  verification would have left behind a probe agent permanently consuming part
  of a ~1,000 request/day free tier. Added `DELETE /api/internal/agent/[id]`
  behind `CRON_SECRET` and made the verifier clean up after itself.
- **The five-field rule needed a structural guard, not a careful route.**
  `PostDoc` deliberately carries extra fields for the newsroom UI and will keep
  growing. Rather than trusting the feed route to stay in sync, `lib/contract.ts`
  became the single exit point: a Mongo projection *and* a key-by-key rebuild,
  so drift cannot leak a sixth key into the evaluator's response.
- **Sort correctness.** `createdAt` is a string, so the feed's sort is
  lexicographic. That is only chronological because every value comes from
  `toISOString()` and is therefore fixed-width — noted in the route, and the
  verifier independently re-checks ordering after parsing the timestamps.

---

## 003 · Step 4 — the tick

**Date:** 2026-08-07
**Tool:** Claude Code (Opus 5) in VS Code

### Prompt

Approval of the phase-4 plan: lock, LLM layer, discovery, charter, editorial
gate, writer, cadence, both triggers, and the Actions workflow — with the gates
being *a real post in the production feed*, then the same with no local machine
involved.

### Produced

`lib/{lock,llm,breeth,discovery,charter,cadence,editor,writer,tick}.ts`,
`scripts/tick.ts`, `POST /api/agent/tick`, and charter generation moved into
init. First live cycle published in 29s using 3 LLM calls, and spiked 7.

### Corrected

Almost everything below came from *running* the thing, not from reading it.

- **The spec's Gemini fallback did not work.** `gemini-2.0-flash` returns
  `429 … limit: 0` on this key, and every 2.5 model 404s on the `v1beta` path
  the docs steer you to. Found `v1/models/gemini-2.5-flash` by listing the
  models the key can actually see. Had this not been probed before writing the
  code, the fallback would have looked fine and only failed the first time Groq
  was down — i.e. exactly when it was needed.
- **Breeth is a graph, not a store.** "TAAR connectivity probe: the editor is
  being wired up" produced 1 entity and **0 edges** — unrecallable. The same
  content as full sentences naming the subject produced **8 entities and 6
  edges**. So `remember()` renders structured facts into subject-verb prose and
  never uses pronouns. This single probe changed the design of the memory layer.
- **A 48-hour freshness window silently deleted arXiv.** For a niche query the
  newest matching preprint is routinely 4-5 days old. Freshness is now
  per-source: 48h for news, 14 days for preprints.
- **Google News links are unpublishable.** They are opaque
  `news.google.com/rss/articles/CBMi…` redirects that only resolve via in-page
  JavaScript. Added Bing News *alongside* it — Bing puts the real publisher URL
  in a query parameter, so it unwraps to a clean link. Both run the **same**
  queries so they genuinely compete, and dedupe precedence keeps the clean one.
  Immediately visible in the first dispatch, which cites `thestar.com.my`
  directly.
- **The first live desk was 5/8 the same story.** Five outlets' rewrites of one
  AMD/Taalas announcement, so the editor spent its judgement writing six
  variations of "this is a press release". Titles are now clustered by word
  overlap, and the merge count is *kept* and shown to the editor, because wide
  pickup is real signal that cuts both ways.
- **The first dispatch ever filed invented a publishing history** — "a stance I
  have consistently maintained", on day one. The deeper cause was that memory
  holds charter seeds *and* dispatch records and a prompt cannot tell them
  apart: a brand-new agent "recalled 8 prior stances" that were merely its own
  opinions. Fixed structurally — prior dispatches are read from Mongo, which
  knows what was actually published, and only those license a callback. A
  first-ever dispatch was then re-tested and came back clean.
- **A niche persona starved.** "Semiconductor Supply Chains" found two
  candidates, both already seen. Since the evaluator chooses the domain, a thin
  desk now triggers one widening pass over a different slice of the sourcePlan —
  which turned that agent's empty desk into a published dispatch.
- **arXiv rate-limits at ~1 request per 3s** and was returning a steady 429.
  Now sequential and single-query; two queries pushed ticks past 50s.
- **Init took ~18s** because it awaited the Breeth seed. Moved into `after()`.
- **The lock was tested, not assumed** — two ticks fired simultaneously, one
  published, the other logged "lease held by another run" and exited.

---

## 004 · Step 6 — the three pages

**Date:** 2026-08-07
**Tool:** Claude Code (Opus 5) in VS Code

### Prompt

> Build order: (1) `/wire/[agentId]` — dispatch card with the blue-pencil
> marginalia exactly per the design tokens, rendered against Kaveri's live data;
> (2) `/newsroom/[agentId]` — charter card, The Spike log with stamps, wire run
> log, memory panel; (3) front page last, embedding the live wire strip (real
> status from Mongo, not hardcoded) and real dispatches above the fold. After
> each page: screenshot at 390px and desktop, self-critique against the tokens,
> then show me before moving on.

### Produced

All three pages, server-rendered from Mongo directly rather than through our own
HTTP API, plus `lib/queries.ts`, `lib/format.ts` and six components. Screenshots
at 1440 and 390 after each page, captured with `reducedMotion: "reduce"` so
animations show their settled end state and captures are deterministic.

### Corrected

Every one of these came from *looking at the rendered page*. None would have
been caught by reading the code.

- **The dateline rendered as the single letter "T".** The teletype effect
  animated `width`, which makes the reveal a layout property — the final frame
  has to land on a `calc()` that exactly equals the rendered text, and it
  didn't.
- **Fixing that broke 390px differently.** Switching to `clip-path` fixed
  desktop, but `clip-path` on a multi-line **inline** element clips everything
  after the first fragment in Chromium, so the wrapped slug silently lost
  "2026 · 15:33 UTC". Found by probing computed styles — the box was 28px tall,
  i.e. two lines, one of them invisible. Both bugs ate the one line saying which
  story this is and when it moved. Now `inline-block` above 768px only, plain
  text below, and it fails safe: no animation means no clip.
- **The newsroom was 23,000px tall.** Forty spikes buried the charter, the
  memory panel and the run log. Capped at 12 — with the true totals counted by a
  separate aggregate, since deriving them from a truncated list would understate
  the number that most demonstrates judgement.
- **Breeth's metadata contradicts itself, so it was cut.** The memory panel
  showed `intent_meta.why_connected` under each fact. The edge "Kaveri covers
  Sustainable AI Data Centers" came back annotated "states Kaveri's position on
  proprietary chip architectures moving toward open standards". Checked against
  the raw API rather than assuming a mapping bug — roughly half were attached to
  the wrong fact. On a page whose purpose is proving the editor's memory is
  real, an explanation that contradicts what it explains is worse than none.
  Only `fact` renders now; the fields are still stored.
- **A CSS layering bug made the run log unreadable.** Notes rendered in ALL CAPS
  despite `normal-case`, because `.wire` sat *outside* Tailwind's layers and
  unlayered CSS outranks anything layered. Moved `.wire` and `.display` into
  `@layer components` so utilities win, which is the expected mental model.
- **A `box-shadow` slipped into the spike stamp** for its ink texture, in a
  design system that bans shadows outright — including inset ones. Replaced with
  a border plus an offset outline.
- **API paths were being uppercased** by `.wire` on the front page, which is
  simply wrong for a URL. And the wire link read "All 1 dispatches".
- **`Field` rendered `<section>`**, nesting sections inside the charter card,
  and the source plan printed a separator after its last item.
- **Cycle count was cut from the wire masthead** on self-critique — telemetry on
  a reader-facing page. It belongs in the newsroom run log, where it means
  something.

### Also this session

- **The GitHub token could not push the workflow.** Scopes were
  `gist, read:org, repo` with no `workflow`, so both `git push` and the contents
  API refused the file (the latter as a disguised 404). Resolved by running the
  device-code flow and surfacing the one-time code.
- **The cron schedule was moved off the hour.** `*/30` fires at `:00` and `:30`;
  GitHub's own docs name the start of the hour as its most delayed slot. Changed
  to `9,39 * * * *` — same cadence, off the crowd.

---

## 005 · Phase 7, Priorities 0–1 — redundancy, and proof

**Date:** 2026-08-07
**Tool:** Claude Code (Opus 5) in VS Code

### Prompt

> **Priority 0 — Dual-scheduler redundancy (now, before anything else).** We
> will run BOTH schedulers in parallel permanently […] not a fallback to switch
> to, a parallel line to leave on. Hand me a copy-paste block for cron-job.org
> […] Extend `/api/health` with `lastRunByTrigger` […] keep the claims separate
> and accurate: if the first unattended publish comes via cron-job.org, the
> evidence says so.
>
> **Priority 1 — Autonomous publish evidence.** […] Do not merge "autonomous
> path works" and "scheduler fires unattended" into one claim until both are
> individually evidenced.

### Produced

`lastRunByTrigger` in `/api/health`, a scheduler-liveness check in the verifier,
the cron-job.org setup block, and the README's **Autonomy evidence** section —
three claims, evidenced separately.

**First fully autonomous dispatch: `2026-08-07T18:01:07Z`**, via cron-job.org,
204 words sourced from arXiv, while the last human-triggered write had been 66
minutes earlier.

### Corrected

- **The pinger would have failed on every single run.** cron-job.org's free tier
  abandons a request at 30 seconds; a full cycle took **30.6s**. The route now
  answers **202 in 0.94s** and does the work in `after()`. This is the failure
  that matters most in hindsight: it would not have looked broken, it would have
  looked like a scheduler that never worked, and a job whose history is entirely
  red is one nobody opens.
- **A GET would have 405'd.** The cron-job.org form defaults its method
  dropdown to GET; the route is POST-only. Caught by testing both verbs against
  production and showing the actual `[405]` rather than describing it.
- **Two deploys failed on lint and production served a stale revision for
  eleven minutes.** `prefer-const` rejected `let lastRunByTrigger`. The cause
  was my own checking: I had run `tsc --noEmit`, which does not run ESLint,
  where Next's build does. Full `npm run build` is the pre-push check now.
- **I reported a deploy failure that had not happened.** My wait loop read the
  newest *row* of `vercel ls`, which was a stale Error entry while the real
  build had not yet appeared. Replaced with a poll against the specific
  deployment URL.
- **I called GitHub's scheduler dead. It was slow.** After four missed
  boundaries and 93 minutes of silence I wrote that it had "not fired
  unattended even once" — true at the time, and I proposed alternatives on that
  basis. It then fired at `17:27:59Z`, delivering the `:09` slot 19 minutes
  late. The lesson is not to wait longer before reporting, it is that a
  four-boundary gap is exactly the failure the second scheduler exists to
  absorb — and it did.
- **A one-hour gap in the analysis, closed without spending budget.**
  `decideCadence` was read rather than tested: `minutesSince` is `null` for a
  new agent and the gap check is guarded on it, so a first dispatch skips
  `minGap` entirely. No fix needed, and no LLM calls spent proving it.
- **A latent fairness bug found by reading, not by failing.** The roster sorts
  `{lastPostAt: 1}` and Mongo sorts `null` first, so an agent that never manages
  to publish permanently holds a slot ahead of healthy ones. Invisible with one
  agent; live once the evaluator's agent joins ours.

### Then, overnight hardening

**Prompt:** *"but i will not wake all night"* → chose **"do the zero-cost
hardening"**: agent fairness, empty states and 404, and the rationale-honesty
fix. No LLM spend, no risk to the running soak.

- **Groq's limits were checked, not assumed.** The worry was a daily token cap
  starving the soak while nobody watched. The headers say
  `limit-requests: 1000` and `limit-tokens: 12000` — and the token limit is
  **per minute**, resetting in 205ms, against cycles roughly ten minutes apart.
  Observed usage is about one call per cycle, ~144/day, so the real headroom is
  around 7×. Many cycles cost zero calls because dedupe leaves nothing fresh.
- **The fairness bug was fixed properly.** Ordering now uses `lastRunAt` and
  every processed agent is stamped — *including one that threw*, which was the
  subtle half: an agent failing every cycle would otherwise keep a null
  timestamp and hold first place forever, recreating the starvation from the
  other direction.
- **The rationale-honesty fix.** The prompt already said nothing else cleared
  consideration; it was not forceful enough. It now forbids the claim outright
  and the system prompt explains why — the rationale is the part a reader
  trusts us on, so a false statement about our own process costs more there
  than anywhere else.
- **Empty states were rendered, not imagined.** A paused agent was inserted
  straight into Mongo — `status: "paused"`, so the roster ignores it and the
  check cost nothing — and the pages screenshotted from production. Two lies
  surfaced immediately: the wire's masthead promised *"every story below was
  found, judged and written without a human in the loop"* on a page with no
  stories below it, and the newsroom's run log read *"Showing the last 0 of
  0."*
- **Both first-dispatch promises were stale.** They said "within roughly thirty
  minutes", written when Actions at `*/30` was the only scheduler. With the
  pinger at `*/15` the honest claim is the next cycle, usually within fifteen.
- **The 404 uppercased its own URLs** — `/WIRE/<AGENTID>`, `/API/AGENT/INIT` —
  the same `.wire` text-transform that had already hit the front page, and just
  as wrong on a path someone is meant to copy.
- **Two lint warnings cleared.** An `eslint-disable` for a rule that no longer
  fires, and a type import left behind. A clean build is what makes the next
  real warning visible — which matters, since a lint error had already cost two
  failed deploys today.

### Then, share polish and preflight (Priorities 4–5)

Both zero-cost and untouching of pipeline semantics, so the running soak stayed
comparable.

- **The OG card is a static PNG, not a route.** Rendered by pointing headless
  Chromium at an HTML file built from the design tokens, so real Newsreader and
  Fragment Mono are baked into the image. An `ImageResponse` route would have
  regenerated an identical card on every request for a file that never changes.
- **The favicon is the blue-pencil mark**, not the red stamp. Stamp-red means
  SPIKED and nothing else in this product, and a favicon is not a refusal.
- **A title template moved to the layout**, so every page carries the masthead
  without each one appending "· TAAR" by hand — which two of them were.
- **`scripts/preflight.ts` answers a different question from the verifier.**
  `verify-feed.ts` asks whether the evaluator's integration is correct;
  preflight asks whether the submission is shippable: routes, the empty-feed
  contract, both schedulers alive, required files present, and no `SCAFFOLD`
  text, localhost URLs or Vercel preview URLs left in the tree. **26 passed, 0
  failed** against production. It refuses to run against localhost, and ends by
  printing the checklist a script cannot verify — a private repo and a disabled
  cron job are the two likeliest ways to sink this, and no amount of curl
  notices either.
- **A token-drift audit on the deployed stylesheet** rather than the source:
  all six tokens present, `border-radius` only ever `0` or `1px`, and the single
  `box-shadow` string is Tailwind's reset variable rather than an applied
  shadow.

---

## 006 · The overnight silence

**Date:** 2026-08-08
**Tool:** Claude Code (Opus 5) in VS Code

### Prompt

> "i wake up, check all things now"

### What the check found

Every mechanical check was perfect and the product had still failed.

```
preflight       26 passed · 0 failed
Actions         10 runs, 10 success, 9 schedule events
schedulers      actions 02:14 · http 03:15 — both alive
errors          zero
Groq budget     998/1000 remaining
posts           2        ← expected 5-6
```

**The wire had published nothing for nine and a half hours**, with its filing
window open the entire time. Every cycle read the same thing:

```
03:15  found=32  fresh=0  spiked=0  llm=0
03:00  found=33  fresh=1  spiked=1  llm=1
02:15  found=30  fresh=0  spiked=0  llm=0
```

Discovery was finding 30+ candidates a cycle and dedupe was eliminating every
one. This is the most useful thing the soak produced: a failure that no
green check could have caught, because nothing was broken. It was working
exactly as written, and what was written was wrong.

### Corrected

- **A hold is not a refusal, and dedupe treated it as one.** `hold` means "real
  but not yet — needs corroboration or a development", and holds were being
  excluded forever, identically to spikes. The one verdict that exists in order
  to be revisited never was. At six cycles an hour the editor consumed its own
  candidate pool, permanently burning every near-miss, and overnight nothing
  replenished it. Holds now return after a three-hour cooling-off. **This alone
  turned a silent cycle into a published dispatch — and the story it filed,
  "Triton for MTIA", was one it had held at score 60 hours earlier.**
- **The query pool was too small to sustain a long run.** Six queries against a
  permanently shrinking reachable set. The pool is now the sourcePlan *and* the
  beats — roughly double, and on-topic by construction since both came from the
  same charter. An untargeted front-page pull was considered and rejected for
  exactly that reason: it would have flooded a desk capped at eight with
  off-beat noise.
- **Rotation was inert half the time.** The slot was computed per 30 minutes
  while the fastest scheduler fires every 15, so consecutive cycles re-ran
  identical queries.
- **Queries were shallow** — 8 results each. Now 20 for Hacker News, 15 for
  arXiv, 12 for news.
- **The editor did not know it was in a drought.** Checked before assuming the
  bar was wrong: across 60 refusals the mean score was 27.5 and only ten ever
  reached 50, so the refusals were correct on the merits and the material was
  genuinely poor. The bar stayed. What changed is that the editor is now told
  the hours idle and the day's count as facts, and told explicitly that spiking
  the whole desk is still right if nothing clears — a newsroom knows the
  difference between a merely-good story and a sixth mediocre one, and it had
  no way to.

### Verified

Two cycles watched after the change, per the standing rule on pipeline edits.
`fresh` went from a flat zero to 5, then 4, then 3; one cycle published; the
next was correctly held by cadence two minutes later. The published dispatch's
rationale names all three candidates it beat, by title — the honesty fix from
005 working on its first real outing.

---

## 007 · The second agent, and four provider failures behind it

**Date:** 2026-08-08
**Tool:** Claude Code (Opus 5) in VS Code

### Prompt

> "i will not stay with laptop so keep going"

Run the evaluator's first hour for real, then stand up the second publication.

### Produced

A second live editor — **Indus**, AI Policy and Regulation — created through the
public API exactly as an evaluator would, and a front-page index of every
publication. Init took **7.7s**, returned a ready charter, and the feed answered
`{"posts":[]}` immediately.

The two wires read like different people, which is the point:

> **Kaveri** — "…bridging the programming model gaps for custom AI accelerators
> … aligning with my conviction that innovations in software will drive the real
> AI revolution."
>
> **Indus** — "…while much of the global policy discourse remains fixated on the
> often-vague concept of 'AI ethics' … Gujarat is laying concrete tracks."

### Corrected

Standing up a second agent doubled the load and broke four things at once, each
of which had looked fine.

- **The Gemini fallback had never worked.** Pinned to `v1` on the strength of a
  probe that sent neither a system instruction nor JSON mode — and `v1` rejects
  both. Every real call uses both, so the fallback passed a test it could only
  fail in production, and it failed the first time Groq ran out. `v1beta`
  accepts both. **This is the second time a provider assumption survived until
  precisely the moment it mattered**, and the lesson is the same one twice:
  probe the call you are actually going to make.
- **I reported the wrong budget last night.** Groq caps this model at 100,000
  tokens per *day* and publishes that nowhere in the response headers — only in
  the body of the 429. I read `x-ratelimit-remaining-requests: 998/1000` and
  told the user there was 7× headroom while the account was at 96.7k tokens.
  Usage is now read from every response, summed into the run log, and the
  provider switches at 80k.
- **The cheap frequent task was starving the expensive rare one.** Judging and
  drafting shared the 70b, but judging runs many times an hour and drafting
  three times a day. The gate moved to `llama-3.1-8b-instant` — its own daily
  bucket, and the same six-verdict JSON in **465 tokens against ~2,000**.
  Drafting stays on the 70b, where the difference is legible to a reader.
  `gpt-oss-20b` was tried first and rejected: it cannot hold JSON mode.
- **Retries were spending a scarce allowance to be told the same thing.**
  Gemini's free tier here is **twenty requests a day**, and every failure burned
  two of them. A per-day quota rejection is no longer retryable.
- **Gemini truncated the gate's JSON mid-object.** 2.5 Flash spent 823 tokens
  reasoning to produce 441 of answer. With `thinkingBudget: 0` the same prompt
  costs 520 total and parses — 60% cheaper and structurally incapable of running
  out mid-object.
- **A never-published agent could never be in "drought".** The check keyed on
  minutes since the last dispatch, which is null until there is one — so the
  nudge skipped precisely the agent that most needs to publish: the evaluator's,
  minutes after they created it. The idle clock now runs from creation when
  nothing has been filed, with a 25-minute fuse rather than four hours.
- **I broke the build mid-session** with a type error, caught before pushing
  because `npm run build` is now the pre-push check rather than `tsc --noEmit`.

### The policy this settled

A quality-tier call that exhausts both the good model and the fallback now drops
to the fast model rather than failing. On a free tier the honest choice is a
dispatch written by a smaller model over a wire that goes dark, and the run log
records which model wrote each one.

---

## 008 · Lockdown — secrets, the last two tests, and the budget

**Date:** 2026-08-08
**Tool:** Claude Code (Opus 5) in VS Code

### Prompt

Phase 8: make it submission-proof. Audit for leaked credentials, prove the one
untested designed behaviour, measure the operating budget, then **freeze the
pipeline** and let it run unattended.

> "Work top to bottom. The code window closes at the end of Priority 2 — after
> that, `lib/` and the pipeline are FROZEN except for a genuine production-down
> emergency."

### Produced

A clean secret audit, a preflight that scans for credentials, `docs/rotation.md`,
the charter-recovery path proven live, a bounded canonical-source preference, a
measured operating budget in the README, and a code freeze at `5ab4233`.

### Corrected

- **The secret audit came back clean, which was worth proving rather than
  assuming.** No credential appears in any tracked file or anywhere in
  `git log -p --all`; `.env.local` was never tracked. That mattered for more
  than tidiness — a leak would have forced a history rewrite, and Stage 2
  audits commit authenticity. Rotation, not rewriting, is the remedy for
  material exposed in transcripts.
- **The existing hygiene scan could not see the file most likely to leak.** It
  filtered to code extensions and skipped Markdown entirely — and `PROMPTS.md`
  is a required *public* deliverable that quotes freely from working sessions.
  The new scan is driven by `git ls-files`, and it looks for the current
  `CRON_SECRET` by reading it from the environment rather than writing the
  literal into the repository, which would have put the secret into the very
  check meant to keep it out.
- **The rotation list was missing the most dangerous credential.** `MONGODB_URI`
  carries the database password and was handled in the same sessions. It is not
  an API key with a spend limit; it is read/write access to production,
  including the ability to delete the evaluator's agent and every dispatch. It
  is also the easiest to overlook, because it never appears in a mental list of
  "which API keys do I have".
- **The charter-recovery path was proven, both halves.** Init survived a forced
  failure with `200 {agentId}` in 5.1s and the agent persisted as `pending`;
  the next tick built the charter and the agent went on to judge a desk. In the
  same run the `lastRunAt` fairness ordering was observed working by accident —
  the probe consumed the cycle budget and the other two agents were cleanly
  skipped with "this agent runs next cycle" rather than starved.
- **The budget guard added that morning was itself wrong.** It summed tokens
  across both models and compared the total to the 70b's 100k/day cap. The two
  models have separate buckets, so high-volume 8b gate traffic would have
  tripped the switch and shed load onto Gemini's twenty-requests-a-day
  emergency reserve — spending the reserve to protect a budget under no
  pressure. Now tracked per tier.
- **The measured budget missed its own target and was reported rather than
  quietly tuned.** At four agents the gate bucket showed 1.8x headroom against
  a 3x bar. The smallest fix turned out to need no code at all — halving the
  external pinger's frequency reaches 3.0x — so the freeze stayed clean and the
  decision went back to the human.
- **Canonical-source preference was kept deliberately small.** Merged clusters
  now promote the publisher over a syndication shell, but 29 of 51 candidates
  on a live pass are aggregator singletons with no sibling to swap to. Fixing
  those means dropping or rewriting candidates — editorial semantics rather
  than link hygiene — so it was left alone and written down instead.

