# Deployment

Two services, two hosts. They are separated because they have genuinely
different runtime needs, not as a preference.

| Part | Host | Why |
|---|---|---|
| `apps/web` | Vercel | A Next.js app. This is what Vercel is for. |
| `apps/api` | Railway, Render or Fly | Holds WebSockets open and runs agents for minutes at a time. Vercel's functions do neither. |
| Postgres | Neon or Supabase | Managed, with branching for preview environments. |

## Vercel

**Root Directory: leave it as the repository root.** `vercel.json` at the root
already describes the monorepo, so nothing needs configuring in the dashboard.

If you prefer to set Root Directory to `apps/web`, that also works - Vercel then
reads `apps/web/package.json`, whose `build` script builds the shared package
first on its own.

### Why the build was failing

`apps/web` imports `@agents-world/shared`, a workspace package whose
`package.json` points at `./dist/index.js`. `dist/` is gitignored, so on a fresh
clone it does not exist. Running `next build` alone gave:

```
Module not found: Can't resolve '@agents-world/shared'
```

Both fixes above build the shared package before Next.js compiles.

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
