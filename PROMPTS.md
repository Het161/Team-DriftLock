# PROMPTS.md

A running log of how TAAR was actually built. Every working session appends an
entry: the prompt that drove it, what the model produced, and what a human had
to correct. This file is the audit trail — it is meant to be read alongside
`git log`, where the same sessions appear as commits.

Format per entry: **Prompt → Produced → Corrected**.

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
