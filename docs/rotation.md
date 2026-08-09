# Credential rotation runbook

**Deferred until after judging closes. Not run before submission — see below.**

## Why it was written, and why it was deferred

This runbook was written on the assumption that publishing `PROMPTS.md` would
expose the credentials handled while building it, which would make rotation
mandatory before anything public went out.

That assumption was checked rather than acted on. `PROMPTS.md` is a curated build
log, not a transcript, and a scan of **all 57 commits across every branch** finds
no Groq, Gemini, Breeth, or Atlas credential in the repository's history. The
only match is the literal `user:pass@cluster.mongodb.net` placeholder in
`.env.example`, which is a template. `npm run preflight` re-checks every tracked
file for all five secrets on every run and has never flagged one.

So the exposure the runbook was written against does not exist, and rotating
against the deadline carries a real cost that the exposure does not. Five
secrets live in **two** places — Vercel and GitHub Actions. Rotate one and miss
the other and the wire stops filing during judging, unattended, with every
health check still green. That is the exact failure mode of sessions 006 and
009, and it is a poor thing to introduce deliberately on submission day.

**The steps below are correct and still apply.** Run them once judging closes,
then confirm a full cycle publishes before walking away.

- **New keys must be proven working before the old ones are revoked**, because a
  rotation that silently breaks the wire is worse than no rotation at all.

## ⚠️ The database password is on this list

The `MONGODB_URI` contains the Atlas user's password and was handled in the same
sessions. It is not just an API key with a spend limit — it is read/write access
to the production database, including the ability to delete the evaluator's
agent and every dispatch. **Rotate it.** It is the single most damaging
credential of the set and the easiest to overlook, because it never appears in a
"which API keys do I have" mental list.

## What gets rotated

| Secret | Where it is minted | Consumers |
| --- | --- | --- |
| `MONGODB_URI` | Atlas → Database Access → edit user → Edit Password | Vercel, GitHub Actions |
| `GROQ_API_KEY` | console.groq.com → API Keys | Vercel, GitHub Actions |
| `GEMINI_API_KEY` | aistudio.google.com → Get API key | Vercel, GitHub Actions |
| `BREETH_API_KEY` | Breeth dashboard | Vercel, GitHub Actions |
| `CRON_SECRET` | Generated locally (below) | Vercel, **cron-job.org header** |

`NEXT_PUBLIC_APP_URL` is not a secret and does not change.

## Order of operations

Update every consumer **before** revoking anything old. There is a short window
where the pinger 401s while `CRON_SECRET` is half-rotated — that is expected and
harmless, because GitHub Actions covers the gap and the Mongo lease makes an
overlap safe either way.

### 1 · Mint

```bash
# New CRON_SECRET — copy the output, you will need it three times
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Then mint the four external credentials from the table above. **Do not revoke
the old ones yet.**

### 2 · Update local `.env.local`

Paste all five new values. This is what the verification step runs against.

### 3 · Update Vercel (production)

```bash
cd /Users/het/Desktop/ABTalks-Hackathon
S=het-patels-projects-7277c57e

for K in MONGODB_URI GROQ_API_KEY GEMINI_API_KEY BREETH_API_KEY CRON_SECRET; do
  vercel env rm "$K" production --yes --scope $S
done

# Add each back — reads the value from .env.local so nothing is typed twice
for K in MONGODB_URI GROQ_API_KEY GEMINI_API_KEY BREETH_API_KEY CRON_SECRET; do
  V=$(grep "^$K=" .env.local | cut -d= -f2- | sed 's/^"//;s/"$//')
  printf '%s' "$V" | vercel env add "$K" production --scope $S
done
```

### 4 · Update GitHub Actions

```bash
for K in MONGODB_URI GROQ_API_KEY GEMINI_API_KEY BREETH_API_KEY CRON_SECRET; do
  V=$(grep "^$K=" .env.local | cut -d= -f2- | sed 's/^"//;s/"$//')
  gh secret set "$K" --repo Het161/Team-DriftLock --body "$V"
done
gh secret list --repo Het161/Team-DriftLock
```

### 5 · Update cron-job.org — **manual, do not forget**

console.cron-job.org → *TAAR tick (second scheduler)* → **Edit** → Headers →
change the `Authorization` value to `Bearer <NEW_CRON_SECRET>` → Save.

Until this is done the pinger returns 401 on every run. Actions keeps the wire
alive meanwhile.

### 6 · Redeploy

Vercel environment changes do **not** apply to the running deployment. A new
build is required.

```bash
vercel --prod --yes --scope het-patels-projects-7277c57e
```

### 7 · Prove the new secrets work

```bash
export TAAR_DEMO_AGENT=<kaveri-agent-id>

# Mongo + both providers, end to end, on the new credentials
curl -s -X POST "https://taar-psi.vercel.app/api/agent/tick?wait=1" \
  -H "authorization: Bearer <NEW_CRON_SECRET>" | head -40

npm run preflight
npm run verify -- --agent <kaveri-agent-id>
npm run verify -- --agent <indus-agent-id>
```

All three must be green, and the tick must show a real cycle rather than a 401
or a Mongo error. `npm run preflight` also re-scans every tracked file for the
**new** `CRON_SECRET`, so a value accidentally committed during rotation is
caught here.

### 8 · Revoke the old credentials

Only now, and only after step 7 is green:

- Groq → delete the old key
- Google AI Studio → delete the old key
- Breeth → revoke the old key
- Atlas → the password change in step 1 already invalidated the old URI

### 9 · Confirm the wire survived

Wait for one scheduled cycle from **each** trigger — up to ~20 minutes — then:

```bash
curl -s https://taar-psi.vercel.app/api/health
```

`lastRunByTrigger.actions` and `lastRunByTrigger.http` must both show timestamps
*after* the rotation. That is the only proof both schedulers still authenticate.

## Rollback

If something breaks and cannot be fixed quickly, put the old values back into
Vercel and GitHub (they still work until step 8), redeploy, and rotate again
after submission. A working wire with old keys beats a dead wire with new ones —
but the old keys must not stay live once the transcripts are public, so treat
rollback as a delay, not a decision.
