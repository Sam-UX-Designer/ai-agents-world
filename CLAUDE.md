# Working agreements

Standing rules for this repository. They come from things that have already
gone wrong, so they are not preferences.

## Always push after a change

**Every change ends with a commit pushed to `claude/keen-dirac-jjcw14`.**

Vercel builds on push, and on nothing else. Work that is finished locally but
unpushed is invisible: the deployed site keeps serving the previous version
and looks broken or unchanged.

Never tell the user to click **Redeploy** to pick up a fix. Redeploy on a past
deployment rebuilds *that deployment's commit*, so a fix pushed afterwards is
not in it and it fails identically forever. Push a new commit instead.

`claude/keen-dirac-jjcw14` is the only branch and is also Vercel's production
branch. Never push to another branch without asking.

## Secrets

No API key, token or password in source, in a commit, or in a chat message.
Environment variables and the host's settings only. `.env` is gitignored for
this reason.

## The user

A product designer, not a backend engineer, and often working from a phone
without terminal access.

- Plain language. No jargon without a one-line explanation.
- Short and direct. No preamble, no filler.
- Never invent a fact. Say "I don't know" or "I can't check that from here".
- Anything they must do themselves should be clicks in a browser. If a step
  needs a terminal, change the code so it does not.
- Their screenshots are evidence. Read what is actually in them before
  theorising.

## Product rules

- The world never invents state. A robot looks busy because a real agent run
  is in flight, and a progress bar moves because steps actually completed.
- Tools are capabilities; agents are what use them. Never create an agent
  named after a tool.
- Never show an integration as connected when no real OAuth exists behind it.
- Never show a raw database, SQL or driver error to a user. Log it, and
  return a sentence they can act on.
- Do not generate, redraw or replace the island artwork. The product owner
  uploads every visual asset.
- Primary navigation is Home, Tools, History. Nothing else.

## Before pushing

- `pnpm --filter @agents-world/api test`
- `npx tsc --noEmit` in `apps/api` and `apps/web`
- `pnpm --filter @agents-world/shared build && pnpm --filter @agents-world/web build`
- For anything visual, run it and look at it in the browser.

The production build is on that list because typechecking is not it. Two
deployments failed on `useSearchParams() should be wrapped in a suspense
boundary at page "/signin"` - a page that compiled, typechecked and worked in
the dev server, and only broke when Next tried to prerender it. Dev mode never
prerenders, so nothing short of the real build finds this. Run the same command
Vercel runs.
