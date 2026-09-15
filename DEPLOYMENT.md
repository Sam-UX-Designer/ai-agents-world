# Deployment

Two services, because they have genuinely different runtime needs.

| Part | Host | Why |
|---|---|---|
| `apps/web` | Vercel | A Next.js app. This is what Vercel is for. |
| `apps/api` | Render (or Railway / Fly) | Holds WebSockets open and runs agents for minutes at a time. Vercel's functions do neither. |
| Postgres | Comes with Render | Managed, and created for you by `render.yaml`. |

You can ship the web app on its own. Without the API it runs in preview mode:
every screen renders from the real tool catalogue, but agents cannot run and
nothing can be connected. Part 2 below turns that on.

---

## Part 1 — the web app on Vercel

### The error you are seeing

```
The Next.js output directory "apps/web/.next" was not found at
"/vercel/path0/apps/web/apps/web/.next"
```

**In one word:** path.

**In one line:** Root Directory is already `apps/web`, and an Output Directory
setting adds `apps/web/.next` on top of it, so Vercel looks inside
`apps/web/apps/web/` and finds nothing.

Note what this is *not*. The build itself succeeded - the log shows
`Compiled successfully`, nine pages generated and the full route table. Only
the step that collects the finished output looked in the wrong folder. Nothing
is wrong with Next.js.

### The fix

Already done in the repository - there is nothing to change in the dashboard.

A `vercel.json` sat at the repository root saying `outputDirectory:
"apps/web/.next"`. Vercel reads that file from the repository root even when
Root Directory is set to `apps/web`, so the build ran inside `apps/web` and
then looked for `apps/web/.next` relative to it. Hence the doubled path.

It is deleted. The only `vercel.json` left is `apps/web/vercel.json`, whose
output directory is `.next` - correct relative to where the build runs.

**Deployments** → newest → ⋯ → **Redeploy**, on
`claude/keen-dirac-jjcw14` at `Fix both deploys` or later.

Leave the dashboard as it is: Output Directory override **off**, Root
Directory `apps/web`, your Build and Install Command overrides are fine.

---

## Part 2 — the API on Render

Ten minutes of clicking in a browser. No credit card, no terminal.

**What "the backend" is here.** Two pieces: a **database** (Postgres, the same
thing Supabase gives you) and a **server** that runs the agents. Supabase or
Airtable alone would cover the database, but neither can run the second piece
— calling Claude, working through a plan for several minutes, streaming
progress to the island — so a plain database service is not enough on its own.
Render gives you both at once, which is why `render.yaml` exists: it creates
the server and the database together.

### What you need first

Only one thing: your Anthropic API key. Get it in your browser at
[console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key.

No terminal, at any point.

### Deploy

1. Go to [render.com](https://render.com) and sign in with GitHub.
2. **New** → **Blueprint**.
3. Pick **`Sam-UX-Designer/ai-agents-world`**, branch
   `claude/keen-dirac-jjcw14`.
4. Render reads `render.yaml` and creates two things: the API server
   (`agents-world-api`) and its Postgres database (`agents-world-db`). It
   generates the security secrets itself and asks you for two values:

   | Field | What to paste |
   |---|---|
   | `ANTHROPIC_API_KEY` | Your Anthropic key |
   | `APP_URL` | Your Vercel URL, e.g. `https://ai-agents-world.vercel.app` — https, no trailing slash |

5. **Apply**. The first build takes 3-5 minutes. It installs, compiles, and
   creates the database tables for you.

   If this first build fails on the last step (`db:migrate`), the database
   was not finished provisioning yet. Click **Manual Deploy** → **Deploy
   latest commit** once and it will go through.
6. When it goes live, Render shows a URL like
   `https://agents-world-api.onrender.com`. Open `<that URL>/health` in your
   browser — it should answer `{"ok":true}`.

### Point the web app at it

1. Vercel → **Settings** → **Environment Variables**
2. Add `API_URL` = your Render URL (no trailing slash)
3. **Redeploy** the web app.

That is the whole connection. The browser only ever talks to your Vercel
domain; Next.js forwards `/api/*` to Render behind the scenes, which is why
the session cookie stays first-party and the API's hostname never reaches the
browser.

You now have working sign-in, real agent runs, and saved history.

### Two things to expect

Render's free instance sleeps after about 15 minutes idle, so the first
request after a quiet spell takes ~30 seconds to wake it. Agent runs survive
this - they are persisted, not held in memory - but it feels slow. Render's
cheapest paid instance removes it.

Claude usage is billed to your Anthropic account, per goal your agents run.
Nothing else here costs anything on the free tiers.

---

## Part 3 — connecting Gmail, Calendar and Slack

Optional, and separate from everything above. Until you do this, the Tools
screen honestly reports that connecting needs credentials rather than offering
a button that fails.

**Google** ([console.cloud.google.com](https://console.cloud.google.com) →
APIs & Services → Credentials → OAuth client ID → Web application):

- Authorised redirect URI: `https://<your-render-url>/auth/google/callback`
- Add to Render: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_REDIRECT_URI`

Gmail and Calendar are *restricted scopes*. Google requires a verification
review before accounts outside your own test list can use them, and that
review takes weeks. Start it early. Your own account works immediately once
you add it as a test user.

**Slack** ([api.slack.com/apps](https://api.slack.com/apps) → Create New App →
OAuth & Permissions):

- Redirect URL: `https://<your-render-url>/auth/slack/callback`
- Add to Render: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`,
  `SLACK_REDIRECT_URI`

Restart the Render service after adding either set. The Tools screen picks
them up on its own - the Connect buttons become live.

---

## Secrets

Every key above goes in Render or Vercel's environment settings. None of them
belong in the repository, in a commit, or in a chat message. `.env` is
gitignored for exactly this reason.

If a key has ever been pasted somewhere it should not have been, rotate it
rather than hoping.
