# AI Agents World

A multi-agent workspace you can watch work.

Give one goal in plain language. An Orchestrator interprets it, breaks it into
tasks, hands them to specialist agents, runs what it can in parallel, and
assembles one answer. You watch the whole thing happen on a living 3D island,
and you can click any agent to see exactly what it is doing.

> **Status:** Phase 1, in development. Not yet runnable end to end.

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

Requires Node 22+ and pnpm 10+.

```bash
pnpm install
pnpm build
pnpm typecheck
```

To run the API you will also need Postgres and a `.env` —
see `apps/api/.env.example`.

```bash
cp apps/api/.env.example apps/api/.env   # then fill it in
pnpm dev:api
```

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
