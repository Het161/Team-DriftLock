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
