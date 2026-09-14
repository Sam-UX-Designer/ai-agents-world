# AI Agents World

A multi-agent workspace you can watch work.

Give one goal in plain language. An Orchestrator interprets it, breaks it into
tasks, hands them to specialist agents, runs what it can in parallel, and
assembles one answer. You watch the whole thing happen on a living 3D island,
and you can click any agent to see exactly what it is doing.

> **Status:** Phase 1. Runs end to end on a laptop with `pnpm dev` — no API
> keys, no database to install.

---

## The one rule

**The 3D world never invents state.**

A robot looks busy because a real agent run is in flight. A progress bar moves
because steps actually completed. Nothing on the island is animation for its
own sake — it is a view onto real execution.

## Phase 1

Orchestrator + Email Agent + Calendar Agent + Slack Agent, working end to end
with real integrations, real execution and real persisted state.

Finance, Research, CRM and Documents follow once Phase 1 is stable.

## Layout

```
apps/
  api/        Fastify API, Orchestrator, agent runtime, event bus
  web/        Next.js + React Three Fiber        (not yet scaffolded)
  mobile/     Expo / React Native                (not yet scaffolded)
packages/
  shared/     Domain model, agent registry, event protocol
docs/
  ARCHITECTURE.md
```

`packages/shared` is the contract. Agent states, the permission gate, the plan
schema and the event protocol all live there, so the backend and both clients
read one definition and cannot drift apart.

## Getting started

Requires Node 22+ and pnpm 10+. Nothing else — no Postgres to install, no
API keys, no accounts.

```bash
pnpm install
pnpm dev
```

Then open the link it prints:

```
http://localhost:3000/api/demo/login
```

That signs you in and lands you on the island. Ctrl+C stops both servers.

### What is real and what is not

`pnpm dev` runs the actual product, not a mock of it.

| Real | Faked |
|---|---|
| The API, every route, the permission gate | **Claude**, because it needs a paid API key |
| Postgres — compiled to WebAssembly, running in-process | **Google and Slack tokens**, because those need OAuth apps |
| Sessions, the WebSocket, live agent events | |
| Every screen: Home, Tools, History | |

So the agents answer from a scripted plan rather than from Claude, with
realistic pauses, and the island shows genuine parallel work driven by real
database state and real events. Everything you click is the production path.

### Running it for real

Two things turn the faked column into the real one, and neither belongs in
this repository:

```bash
cp apps/api/.env.example apps/api/.env   # then fill it in
pnpm dev:api                             # real Postgres, real Claude
```

- `ANTHROPIC_API_KEY` — agents start thinking for themselves.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `SLACK_CLIENT_ID` /
  `SLACK_CLIENT_SECRET` — the Connect buttons on Tools complete real OAuth.

**Keys go in `.env` or in your host's environment settings. Never in the
source code** — `.env` is gitignored for exactly this reason.

## Reading the code

Start with these four files, in order. They are the product:

| File | What it decides |
|---|---|
| `packages/shared/src/agents/registry.ts` | Who the agents are, what they may touch, where they stand |
| `packages/shared/src/domain/permissions.ts` | When an agent may act alone and when it must ask you |
| `packages/shared/src/domain/plan.ts` | What a plan is, and what makes one runnable |
| `packages/shared/src/events/protocol.ts` | Everything the 3D world is allowed to know |

Then `docs/ARCHITECTURE.md` for how they fit together.

## Permissions, in one table

| The agent is... | Behaviour |
|---|---|
| Reading, researching, analysing, summarising | Runs on its own. Never asks. |
| Drafting something you have not sent | Runs on its own. A draft has not left your workspace. |
| Sending, posting, or changing a connected system | Asks first — unless you chose "don't ask again" for that action |
| Moving money, or deleting data | **Always** asks. No setting waives this. |
