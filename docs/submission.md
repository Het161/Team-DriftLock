# Sunday runbook

Deadline **20:00 IST**. We submit at **18:00 IST**, two hours early, because
judging traffic begins after the deadline when nobody is watching.

All times IST. UTC in brackets — the wire and every log run on UTC.

| Value | |
| --- | --- |
| Repo | `https://github.com/Het161/Team-DriftLock` |
| Live | `https://taar-psi.vercel.app` |
| AI-usage log | `https://github.com/Het161/Team-DriftLock/blob/main/PROMPTS.md` |
| Kaveri (AI Infrastructure) | `72c2d7a4-dfad-4384-8c3a-df64b0e9cd0e` |
| Indus (AI Policy and Regulation) | `220f5426-fe4e-4f50-b873-c77c9f72ca7b` |

---

## 1 · Morning — overnight evidence

```bash
cd ~/Desktop/ABTalks-Hackathon
export TAAR_DEMO_AGENT=72c2d7a4-dfad-4384-8c3a-df64b0e9cd0e
npm run preflight
curl -s https://taar-psi.vercel.app/api/health
gh run list --repo Het161/Team-DriftLock --workflow taar-tick --limit 20
```

- [ ] Actions history green, no failures
- [ ] **Both** agents filed at least once overnight
- [ ] Zero `error` outcomes in the run log
- [ ] `lastRunByTrigger` shows both `actions` and `http` within the last 2h

Fold the final overnight numbers into the README's **Autonomy evidence**
section. Claims stay exactly as strong as the evidence — if only one scheduler
fired, say that.

## 2 · Visual pass

Open on the **real phone**, not a simulator, and on desktop:

- [ ] `/` — wire strip reads live, dispatches render, publications index lists both editors
- [ ] `/wire/72c2d7a4-…` — marginalia in the margin on desktop, tappable note on mobile
- [ ] `/newsroom/72c2d7a4-…` — charter, spike stamps, memory, run log

Fix only visual breakage. **The code is frozen** — no tuning, no "while I'm in
here".

## 3 · ~15:00 IST (09:30 UTC) — rotate every credential

Follow **[docs/rotation.md](rotation.md)** end to end. It is nine ordered steps;
do not improvise the order. The parts most easily forgotten:

- [ ] `MONGODB_URI` too — it is the database password, not just an API key
- [ ] **cron-job.org header** updated by hand to the new `Bearer` value
- [ ] **Redeploy** — Vercel env changes do not reach a running deployment
- [ ] Prove before revoking: authenticated tick + preflight + both verifiers
- [ ] Only then revoke the old keys
- [ ] Wait for one cycle from **each** trigger and confirm both timestamps moved

Budget 45 minutes. If it goes wrong, roll back to the old values (they still
work until you revoke) and rotate again after submission — a working wire with
old keys beats a dead wire with new ones.

## 4 · Final sweep (~17:30 IST / 12:00 UTC)

```bash
npm run preflight
npm run verify -- --agent 72c2d7a4-dfad-4384-8c3a-df64b0e9cd0e
npm run verify -- --agent 220f5426-fe4e-4f50-b873-c77c9f72ca7b
gh repo view Het161/Team-DriftLock --json visibility,isPrivate
```

- [ ] preflight green, **including the secret scan**
- [ ] both verifiers green
- [ ] repo is **public**
- [ ] Actions history public and green
- [ ] README and PROMPTS.md current and pushed
- [ ] feed opened once from **mobile data**, not home wifi

## 5 · Submit by 18:00 IST (12:30 UTC)

```
Repo URL      https://github.com/Het161/Team-DriftLock
Live URL      https://taar-psi.vercel.app
AI-usage log  https://github.com/Het161/Team-DriftLock/blob/main/PROMPTS.md
```

## 6 · After submission

**Touch nothing.** No pushes, no tweaks, no "one small fix" — every push to
`main` redeploys Vercel *and* changes what the Actions runner checks out, so a
late edit risks the thing being judged.

The wire runs itself. That was the whole point.

---

## If something breaks during judging

Diagnose before acting; most apparent failures are not failures.

| Symptom | Likely cause | Response |
| --- | --- | --- |
| No new posts for hours | Cadence — 3/day, ≥120 min apart | Check `/api/health` `lastTickAt`. If cycles are running, it is working. |
| Cycles running, nothing published | Editor spiking a weak desk | Read `/newsroom/<id>#the-spike`. Refusal with reasons *is* the product. |
| `lastRunByTrigger.actions` stale | GitHub drops scheduled runs under load — observed skipping four boundaries | The pinger covers it. Only act if **both** are stale. |
| Both triggers stale | Real outage | `curl -X POST .../api/agent/tick -H "authorization: Bearer $CRON_SECRET"` to file manually, then investigate. |
| `error` outcomes with 429 | Daily token budget spent | Expected near the cap; it degrades to the fast model rather than dying. Resets on the provider's daily boundary. |
| Feed returns 404 | Wrong agentId | The evaluator's own id is the only one that matters; ours are for the demo. |
