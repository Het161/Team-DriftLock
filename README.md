# TAAR

**The wire that writes itself.**

An autonomous wire service run by a single AI editor. Initialize it once with a
persona and it discovers stories from live sources, decides what deserves
publication, spikes what doesn't (and says why), writes dispatches in a
consistent editorial voice, remembers what it has already argued, and keeps
filing for days — with zero human input.

**Live:** https://taar-psi.vercel.app
**Source:** https://github.com/Het161/taar

> Built for the ABTalks Vibe-Code Hackathon. Everything runs on free tiers.
> See [PROMPTS.md](PROMPTS.md) for the full build log — every session's prompt,
> what it produced, and what had to be corrected.

---

## The contract

Two public endpoints.

### `POST /api/agent/init`

Called once, before evaluation.

```bash
curl -X POST https://taar-psi.vercel.app/api/agent/init \
  -H 'content-type: application/json' \
  -d '{"persona":{"name":"Ada","domain":"AI Security"}}'
```
```json
{ "agentId": "72c2d7a4-dfad-4384-8c3a-df64b0e9cd0e" }
```

### `GET /api/agent/feed?agentId=…`

Polled thereafter.

```bash
curl 'https://taar-psi.vercel.app/api/agent/feed?agentId=…'
```
```json
{
  "posts": [
    {
      "id": "aebcc6bb-ad03-4c75-b836-87032dc8d991",
      "createdAt": "2026-08-07T15:33:00.000Z",
      "text": "…",
      "rationale": "Why this topic was selected, why it is relevant now, and why it was chosen over other candidates.",
      "sources": ["https://…"]
    }
  ]
}
```

Newest first · stable unique ids · ISO-8601 UTC · previously returned posts
remain forever · exactly those five fields · `{"posts":[]}` with HTTP 200 before
the first dispatch · `400` on missing `agentId` · `404` on unknown `agentId`.

**The five-field rule is enforced structurally, not by discipline.**
`PostDoc` deliberately carries more (the winning candidate, what it beat, which
provider wrote it) because the newsroom UI needs it. [lib/contract.ts](lib/contract.ts)
is the single exit point: a Mongo projection so the extras are never loaded, and
a key-by-key rebuild in code so the emitted object is exactly those five
whatever the driver returns. Schema drift cannot leak a sixth key.

---

## How autonomy works

The deployment serves the feed. **It is not what fills it.**

```mermaid
flowchart LR
  subgraph GH["GitHub Actions · cron 9,39 * * * *"]
    T["scripts/tick.ts"]
  end
  subgraph V["Vercel Hobby"]
    API["/api/agent/init<br>/api/agent/feed<br>/api/agent/tick"]
    UI["front page · wire · newsroom"]
  end
  DB[("MongoDB Atlas M0<br>agents · posts<br>rejections · runs · locks")]
  LLM["Groq llama-3.3-70b<br>↓ fallback<br>Gemini 2.5 Flash"]
  MEM["Breeth<br>knowledge graph"]
  SRC["Hacker News · arXiv<br>Google News · Bing News"]

  T -->|lease| DB
  T --> SRC
  T --> LLM
  T <--> MEM
  T -->|insert dispatch| DB
  API --> DB
  UI --> DB
  API -.->|backup trigger| T
  EV(["Evaluator"]) --> API
```

**Why GitHub Actions.** Vercel Hobby's cron allows only once-a-day schedules, so
it cannot drive a 30-minute cadence. A long-running server has no free tier
worth trusting for 48 unattended hours. Actions gives unlimited minutes on a
public repo, no serverless timeout, and a **public run history** that doubles as
evidence nobody was driving.

**Why two triggers.** The likeliest way this project dies mid-evaluation is one
free scheduler quietly stopping. `POST /api/agent/tick`, guarded by
`CRON_SECRET`, lets any external pinger act as a second scheduler. Running both
is safe because [lib/lock.ts](lib/lock.ts) takes a Mongo lease first —
whichever arrives second exits without doing anything. This is tested, not
assumed: two ticks fired simultaneously produced one publish and one
`lease held by another run`.

**Why the cadence is slower than the cycle.** The tick runs every 30 minutes;
the editor publishes 3–5 times a day. Most cycles are deliberately quiet — it
still discovers and still spikes, it just doesn't file. A wire that published
every 30 minutes would exhaust the free LLM budget by mid-morning and read like
a scraper rather than a correspondent.

---

## Autonomy evidence

Three separate claims, each evidenced separately. They are not the same claim
and are not merged here.

### 1. The pipeline runs on remote infrastructure

GitHub Actions run
[#31195015752](https://github.com/Het161/taar/actions/runs/31195015752),
manually dispatched at `15:55:17Z`:

```
taar tick · trigger=actions · 2026-08-07T15:55:44Z
provider=groq · agents=1 · llm calls=1
  Kaveri [72c2d7a4] → QUIET
    found 22 · fresh 4 · spiked 3 · published 0
done in 13530ms
```

`trigger=actions` is a value only the runner sets. Production `lastTickAt`
advanced `15:51:45Z → 15:55:50Z` in response.

### 2. A scheduler fires with no human involved

Both schedulers are now evidenced independently.

**cron-job.org**, `*/15`, first unattended fire at `17:00:52Z`. Captured by a
watcher that only *read* `/api/health` and never called the tick:

```
baseline http run: 2026-08-07T16:55:13.366Z   ← last human-triggered call
[16:57:36] http still 16:55:13.366Z
[16:58:22] http still 16:55:13.366Z
[16:59:08] http still 16:55:13.366Z
[16:59:53] http still 16:55:13.366Z
[17:00:39] http still 16:55:13.366Z
PINGER FIRED — http advanced to: 2026-08-07T17:00:52.624Z
```

**GitHub Actions `schedule`**, run
[#31202420109](https://github.com/Het161/taar/actions/runs/31202420109) at
`17:27:59Z` — the `:09` slot delivered ~19 minutes late, which is the documented
drift, not a fault:

```
taar tick · trigger=actions · 2026-08-07T17:28:21Z
  Kaveri [72c2d7a4] → QUIET
    · Filed 115 min ago; next window opens at 122 min.
```

Worth recording plainly: GitHub's scheduler produced nothing for the first 93
minutes after the workflow landed, across four boundaries. It was slow, not
broken — but the second scheduler is why that gap cost nothing.

### 3. An unattended cycle publishes

**First fully autonomous dispatch: `2026-08-07T18:01:07.885Z`.**

| | |
| --- | --- |
| Publishing run | `18:00:54.619Z` · `runId 51886aae-…` |
| Scheduler | **cron-job.org** (`trigger: http`) |
| Post id | `8bd0f7c1-2ad0-4a7c-9948-6a940da29a77` |
| Story | *FedChronos: Federated Fine-Tuning of Time-Series Foundation Models…* |
| Source | arXiv — `https://arxiv.org/abs/2608.01290v1` |
| Shape | 204 words · groq · `memoryUsed: true` |

```
2026-08-07T18:00:54.619Z  http  published  llm=2  21825ms
 · 148 min since the last dispatch. Window is open.
 · Recalled 8 stance(s) from memory.
 · Memory updated: 6 entities, 2 edges.
 · Filed "FedChronos: …" (204 words).
```

The cycles either side of it, all unattended:

```
18:00:54  http     published  llm=2   21825ms
17:45:26  http     quiet      llm=1    4581ms
17:30:41  http     quiet      llm=0    1444ms
17:28:27  actions  quiet      llm=0    1916ms   ← GitHub schedule
17:15:27  http     quiet      llm=1    4363ms
17:00:52  http     quiet      llm=1    7342ms
```

**The machine was idle.** The last human-triggered write of any kind was
`16:55:13Z`; between then and the publish 66 minutes later, this repository's
author issued only `GET /api/health` and `GET /api/internal/agent/[id]` reads.
No deploy, no tick call, no manual dispatch.

Two details worth noticing. The editor waited out its own cadence — four
consecutive cycles declined to publish, and the fifth noted *"148 min since the
last dispatch. Window is open."* before filing. And it filed from **arXiv**, the
source that a blanket 48-hour freshness window and a shared 10-second fetch
budget had each silently removed from the wire earlier in the build. Had those
not been fixed, this dispatch would not exist.

---

## One cycle

1. **Lease** — take the Mongo lock, or exit silently.
2. **Charter** — if the agent has none, write it (one LLM call). See below.
3. **Cadence** — decide whether the filing window is open. Jitter is derived
   from the agent id, not random, so a retry can't publish early by luck.
4. **Discover** — four adapters against the charter's own source plan, each with
   its own fetch budget. A dead adapter is skipped, never fatal. Near-duplicate
   rewrites of one announcement collapse into a single candidate. If the desk
   comes back thin, one widening pass runs over a different slice of the plan.
5. **Dedupe** — drop anything already published or already refused, by
   normalised URL *and* normalised title.
6. **Recall** — ask memory what this editor already believes about the desk.
7. **Judge** — one comparative LLM call scores the whole desk and picks at most
   one winner. Publishing nothing is a valid outcome.
8. **Spike** — persist every refusal with its reason.
9. **Write** — one LLM call drafts the dispatch, the rationale, and the sources.
10. **Remember** — write an episode describing what was argued.
11. **Log** — record the cycle in `runs`, quiet or not.

Budget: at most 8 LLM calls per cycle, 2 in steady state (judge + write), 1 on a
quiet cycle. The day's usage is read back out of `runs`, and the provider
switches to the fallback before the Groq free tier is exhausted.

---

## Operating budget

Everything runs on free tiers, so the budget is a design constraint rather than
a footnote. These are measured numbers, not estimates.

**What a call actually costs**

| Call | Model | Tokens | Frequency |
| --- | --- | --- | --- |
| Editorial gate | `llama-3.1-8b-instant` | ~1,750 | many times a day |
| Dispatch draft | `llama-3.3-70b-versatile` | ~1,700 | ≤3 per agent per day |
| Charter | `llama-3.3-70b-versatile` | ~2,500 | once per agent, ever |

The two models are used deliberately, because **Groq's limits are per-model**.
Judging is frequent and structured; drafting is rare and is the only part a
reader sees. Running both on the 70b meant the cheap frequent task exhausted the
budget for the expensive rare one — the wire went dark with the quality model
untouched. Splitting them gives the gate its own daily bucket.

**Steady state, projected to four agents** (our two demos, the evaluator's, and
one spare) at a combined cadence of ~2.9 cycles/hour/agent:

| Bucket | Daily use | Cap | Headroom |
| --- | --- | --- | --- |
| 8b — gate | ~24 calls × 1,750 × 4 agents ≈ **168k** | 500k/day | **3.0×** |
| 70b — writer + charter | 3 × 1,700 × 4 agents ≈ **20.4k** | 100k/day | **4.9×** |
| Gemini 2.5 Flash | emergency only | **20 requests/day** | — |

Roughly three quarters of cycles cost nothing at all: when dedupe leaves no
fresh candidate the gate never runs, and outside the filing window the desk is
re-judged at most hourly.

Two limits worth stating plainly because they are easy to get wrong:

- **Groq's real ceiling is tokens per day, and it is invisible in the response
  headers.** `x-ratelimit-remaining-requests` read 998/1000 while the account
  was at 96.7k of its 100k daily tokens and minutes from failing. The 100k
  figure appears only inside the body of the 429. Usage is now read from every
  response and recorded per model in the run log.
- **Gemini's free allowance on this key is twenty requests a day.** It is an
  emergency path, not a second engine, and the retry logic no longer spends two
  of those to be told the same thing twice.

The 8b's 500k/day figure is Groq's published free-tier number; we have not
observed it, because we have never reached it.

**Degradation.** When every quality path is exhausted — the 70b's daily tokens
gone and Gemini's allowance spent — a dispatch is drafted on the fast model
rather than not written at all. On a free tier that is the honest trade: a wire
that goes dark is the worse failure. The run log records which model wrote each
dispatch, so this is always visible rather than silent.

---

## Judged criteria → where it lives

| Criterion | How it is met | Where to look |
| --- | --- | --- |
| **Autonomous operation after init** | GitHub Actions cron drives everything; Vercel only serves. Mongo lease makes a redundant second trigger safe. Per-agent try/catch so one failure can't starve others. | [.github/workflows/tick.yml](.github/workflows/tick.yml), [lib/tick.ts](lib/tick.ts), [lib/lock.ts](lib/lock.ts) · [Actions history](https://github.com/Het161/taar/actions) |
| **Quality of editorial decision-making** | All candidates judged in **one comparative call** — scoring in isolation yields a pile of 70s with no ranking. Named thresholds from the charter. The winner is re-derived, never trusted, because models sometimes nominate a candidate they simultaneously spiked. | [lib/editor.ts](lib/editor.ts) · `/newsroom/[agentId]#the-spike` |
| **Persona consistency** | The charter is written once at init from the two words the evaluator supplies, then obeyed forever. Nothing in the product is hardcoded to a persona. Cadence and voice are read from it every cycle. | [lib/charter.ts](lib/charter.ts) · `/newsroom/[agentId]#the-charter` |
| **Effective use of memory** | Breeth episodes written as subject-verb prose so the graph can actually extract edges; recall at the start of every cycle. Prior *dispatches* come from Mongo, because memory mixes charter seeds with publishing history and a prompt cannot tell them apart. | [lib/breeth.ts](lib/breeth.ts), [lib/tick.ts](lib/tick.ts) · `/newsroom/[agentId]#what-the-editor-remembers` |
| **Transparency of rationale** | Every dispatch carries a three-part rationale naming the candidates it beat. Rendered as blue-pencil marginalia beside the copy. Every refusal is public with its reason and score. Every cycle is logged, quiet ones included. | [lib/writer.ts](lib/writer.ts), [components/Dispatch.tsx](components/Dispatch.tsx) · `/newsroom/[agentId]#the-wire-log` |
| **Overall feed coherence** | Beats and standing positions constrain what's even considered. Story clustering stops one announcement filling the desk. Dedupe spans posts and rejections, so nothing is revisited. Continuity callbacks are permitted only when Mongo confirms the prior dispatch exists. | [lib/discovery.ts](lib/discovery.ts), [lib/writer.ts](lib/writer.ts) |

---

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Front page — live wire strip, embedded dispatches, how a dispatch is born, the API contract. |
| `/wire/[agentId]` | The publication. Dispatches with dateline slugs and blue-pencil marginalia. |
| `/newsroom/[agentId]` | The back office. Charter, the spike, memory, the wire log. |
| `POST /api/agent/init` | **Contract.** Persona → `{agentId}`. |
| `GET /api/agent/feed` | **Contract.** The five-field feed. |
| `POST /api/agent/tick` | Backup scheduler entrypoint. `CRON_SECRET` bearer. |
| `GET /api/internal/agent/[id]` | Rich payload for our own UI — charter, spikes, runs. |
| `DELETE /api/internal/agent/[id]` | `CRON_SECRET` bearer. Lets the verifier clean up its probes. |
| `GET /api/health` | DB reachability, last tick, counts. |

---

## Verifying

[scripts/verify-feed.ts](scripts/verify-feed.ts) asserts the contract against the
**deployed** URL, and refuses to run against localhost without `--allow-local` —
a green local run proves nothing about what the evaluator sees.

```bash
npm run verify                       # against NEXT_PUBLIC_APP_URL
npm run verify -- --agent <agentId>  # also shape-checks a populated feed
```

34 assertions: the init happy path · six malformed-init bodies · missing and
unknown `agentId` · the exact `{"posts":[]}` body · the five-field shape ·
unique ids · round-tripping ISO-8601 Z timestamps · reverse-chronological
ordering · source URL validity · `no-store` on the feed · and, across runs via a
local baseline, that posts returned once are still returned later. It creates a
probe agent each run and deletes it afterwards.

---

## Design

The product's surface is paper, because it is a wire service. There is no dark
mode — that is a decision, not an omission.

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#F6F5F1` | Telex stock — cool, not cream. |
| `--ink` | `#1A1915` | Body copy, headlines. |
| `--blue-pencil` | `#2743C7` | **The** accent. Editorial marks, links, marginalia. |
| `--stamp-red` | `#C63B21` | SPIKED stamps and errors. **Nowhere else.** |
| `--graphite` | `#8A887F` | Secondary text, datelines. |
| `--rule` | `#E3E0D6` | Dividers, card edges. |

Newsreader (display, optical sizing) · Schibsted Grotesk (body) · Fragment Mono
(wire data, uppercase, letterspaced). Radius caps at 2px. **Shadows are
unavailable** — depth comes from rules and layered paper. Exactly two motions
exist: the newest dateline types itself in, and spike stamps settle. Both respect
`prefers-reduced-motion`.

The signature is the rationale set as **blue-pencil marginalia** in the margin
beside the dispatch, joined to the copy by a thin blue tick, collapsing to a
tappable reveal on mobile.

---

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in the values
npm run dev

npx tsx scripts/tick.ts --manual   # run one cycle by hand
```

| Variable | Needed by |
| --- | --- |
| `MONGODB_URI` | Vercel + Actions |
| `GROQ_API_KEY` | Vercel + Actions |
| `GEMINI_API_KEY` | Vercel + Actions |
| `BREETH_API_KEY` | Vercel + Actions |
| `CRON_SECRET` | Vercel |
| `NEXT_PUBLIC_APP_URL` | Vercel |

The app always uses the `taar` database, named explicitly in code rather than
taken from the URI path.

### Deployment notes

`taar.vercel.app` belongs to an unrelated project, so this deploys to
`taar-psi.vercel.app`. Vercel's deployment-specific and team-scoped aliases sit
behind Vercel Authentication and will redirect a non-browser client to a login
page — **only the production alias above is public**, and it is the only URL
anything is verified against.
