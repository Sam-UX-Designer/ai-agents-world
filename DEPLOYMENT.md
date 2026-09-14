# Deployment

Two services, two hosts. They are separated because they have genuinely
different runtime needs, not as a preference.

| Part | Host | Why |
|---|---|---|
| `apps/web` | Vercel | A Next.js app. This is what Vercel is for. |
| `apps/api` | Railway, Render or Fly | Holds WebSockets open and runs agents for minutes at a time. Vercel's functions do neither. |
| Postgres | Neon or Supabase | Managed, with branching for preview environments. |

## Vercel

Vercel hosts `apps/web` only.

**Set Root Directory to `apps/web`** in Project → Settings → Build and
Deployment. `apps/web/vercel.json` handles everything else, including the
output directory, and a `vercel.json` overrides whatever the dashboard says -
so there is nothing else to configure.

### The "output directory was not found" failure

```
Error: The Next.js output directory "apps/web/.next" was not found at
"/vercel/path0/apps/web/apps/web/.next"
```

Read the path: `apps/web` appears twice. Root Directory was already `apps/web`,
and the Output Directory setting said `apps/web/.next` on top of it, so Vercel
looked one folder too deep.

Note what this failure is *not*. The build itself succeeded - the log shows
`Compiled successfully`, nine pages generated and the full route table. Only
the step that collects the finished output looked in the wrong place. Nothing
was wrong with Next.js, and changing framework would not have helped.

The fix is in the repository now: `apps/web/vercel.json` sets
`"outputDirectory": ".next"`, relative to the root directory, which is correct
in both layouts. If a stale **Output Directory** override is still set in
Project → Settings → Build and Deployment, clear it.

### Why the earlier build was failing

`apps/web` imports `@agents-world/shared`, a workspace package whose
`package.json` points at `./dist/index.js`. `dist/` is gitignored, so on a
fresh clone it does not exist. Running `next build` alone gave:

```
Module not found: Can't resolve '@agents-world/shared'
```

`apps/web/package.json`'s own `build` script builds the shared package first,
which is what Vercel runs, so this is handled.

### The API does not go on Vercel

`apps/api` holds WebSockets open and runs agents for minutes at a time.
Vercel's functions do neither. Deploy it to Railway, Render or Fly, then point
the web app at it with the `API_URL` variable below.

Until you do, the deployed site will load but every screen will be empty - the
browser is calling an API that is not there yet. That is expected, not a bug.

### Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**. Never in
the repository.

| Variable | Value |
|---|---|
| `API_URL` | The public URL of the deployed API, e.g. `https://api.yourdomain.com` |

`API_URL` is the one the frontend genuinely needs. `next.config.ts` rewrites
`/api/*` to it, which keeps the session cookie first-party and keeps the API's
hostname out of the browser. Without it the site builds and deploys, then every
request 404s against Vercel itself - a failure that looks like a bug in the app
rather than missing configuration.

## API host (Railway / Render)

Every secret lives here, not on Vercel, because this is the process that uses
them. See `apps/api/.env.example` for the full list. The ones without which the
service will not start:

| Variable | How to get it |
|---|---|
| `DATABASE_URL` | Your Postgres provider |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `SESSION_SECRET` | `openssl rand -base64 48` |

Optional, per feature:

| Variable | Enables |
|---|---|
| `ELEVENLABS_API_KEY` | Agents speaking aloud. Without it they reply in text and nothing breaks. |
| `GOOGLE_CLIENT_ID` / `_SECRET` | Gmail and Calendar |
| `SLACK_CLIENT_ID` / `_SECRET` | Slack |
| `MICROSOFT_CLIENT_ID` / `_SECRET` | Microsoft sign-in |

**The ElevenLabs key belongs on the API host, not on Vercel.** The
text-to-speech call is made server-side on purpose, so the key never reaches a
browser. A key set in Vercel's environment is only visible to Vercel-hosted
code, which is not where that call runs.

Config is validated at boot in `apps/api/src/config.ts`, so a missing secret
stops the process immediately with a message naming it, rather than surfacing
hours later as an agent failing mid-run.
