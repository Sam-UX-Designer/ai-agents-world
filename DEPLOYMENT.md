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

1. Vercel → your project → **Settings** → **Build and Deployment**
2. Find **Output Directory**. It has `apps/web/.next` typed into it.
3. **Clear that field** and save. Leave it empty.
4. Check **Root Directory** just above it says `apps/web`.
5. **Deployments** → newest → ⋯ → **Redeploy**.

Step 3 is the one that matters. `apps/web/vercel.json` already specifies the
right output directory; the dashboard value was fighting it.

If it fails again, check which commit deployed - the Deployments list shows
the commit next to each build. It must be on `claude/keen-dirac-jjcw14`, at
`Ease the frost back to 78-85%` or later.

---

## Part 2 — the API on Render

Fifteen minutes, no credit card. Render is used here because it is the
shortest path to a long-lived Node process with a Postgres beside it; Railway
and Fly work the same way.

### Before you start

Generate the encryption key. In your terminal:

```bash
openssl rand -base64 32
```

Copy the line it prints. It encrypts the Gmail and Slack tokens your agents
use, so treat it like a password: paste it into Render only, never into the
repository or a chat.

You also need your Anthropic API key from
[console.anthropic.com](https://console.anthropic.com) → API Keys.

### Deploy

1. Go to [render.com](https://render.com) and sign in with GitHub.
2. **New** → **Blueprint**.
3. Pick **`Sam-UX-Designer/ai-agents-world`**, branch
   `claude/keen-dirac-jjcw14`.
4. Render reads `render.yaml` and shows two services: `agents-world-api` and
   `agents-world-db`. It then asks for three values:

   | Field | What to paste |
   |---|---|
   | `ANTHROPIC_API_KEY` | Your Anthropic key |
   | `TOKEN_ENCRYPTION_KEY` | The `openssl` line from above |
   | `APP_URL` | Your Vercel URL, e.g. `https://ai-agents-world.vercel.app` — https, no trailing slash |

5. **Apply**. First build takes 3-5 minutes. It installs, compiles, and runs
   the database migrations for you.
6. When it goes live, Render shows a URL like
   `https://agents-world-api.onrender.com`. Open `<that URL>/health` — it
   should answer `{"ok":true}`.

### Point the web app at it

1. Vercel → **Settings** → **Environment Variables**
2. Add `API_URL` = your Render URL (no trailing slash)
3. **Redeploy** the web app.

That is the whole connection. The browser only ever talks to your Vercel
domain; Next.js forwards `/api/*` to Render behind the scenes, which is why
the session cookie stays first-party and the API's hostname never reaches the
browser.

You now have working sign-in, real agent runs, and saved history.

### One thing to expect

Render's free instance sleeps after about 15 minutes idle, so the first
request after a quiet spell takes ~30 seconds to wake it. Agent runs survive
this - they are persisted, not held in memory - but it feels slow. Render's
cheapest paid instance removes it.

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
