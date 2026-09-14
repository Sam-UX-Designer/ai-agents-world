# AI Agents World — Architecture

Working product name: **AI Agents World**. Repository: `ai-agents-world`.

A standalone product. It shares no code, schema, infrastructure or branding
with Jumbo or any other project.

---

## 1. What the product does

A user types one goal in plain language. An **Orchestrator** interprets it,
breaks it into tasks, assigns each to a **specialist agent**, runs the
independent ones in parallel, collects the results and writes one answer.

The user watches this happen on a 3D island. That island is not an
illustration of the system — it *is* the system's interface. Every robot on it
is a real agent, and every state it shows came from the backend.

## 2. The rule everything else serves

> The 3D world never invents state.

An agent looks busy because a real run is in flight. A progress bar moves
because steps actually completed. When we interpolate for smoothness we mark
the number `estimated` and render it differently, because a progress bar that
moves on a timer is a lie told at sixty frames per second.

This is enforced structurally, not by discipline: the client has no code path
that sets agent state locally. State arrives as events or not at all.

## 3. Layers

```
   Web (Next.js + R3F)        Mobile (Expo + R3F)
              |                        |
              +-----------+------------+
                          |  WebSocket (events)  +  HTTPS (commands)
                   +------v-------+
                   |  API layer   |   Fastify. Auth, tenancy, transport.
                   +------+-------+
                          |
        +-----------------+------------------+
        |                 |                  |
 +------v------+   +------v------+   +-------v-------+
 | Orchestrator|   |Agent runtime|   |   Event bus   |
 |  plan &     |   |  execute &  |   | order, persist|
 |  synthesise |   |  gate tools |   |  & broadcast  |
 +------+------+   +------+------+   +-------+-------+
        |                 |                  |
        +--------+--------+------------------+
                 |                 |
          +------v------+   +------v-------+
          |  Postgres   |   | Integrations |
          |  state &    |   | Gmail, GCal, |
          |  audit      |   | Slack (OAuth)|
          +-------------+   +--------------+
```

The 3D layer is a **consumer of state**. It holds no business logic, no
credentials, and no authority over what an agent is doing.

## 4. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript, everywhere | One type definition shared by API, web and mobile means the event protocol cannot drift |
| Web | Next.js + React Three Fiber | R3F is Three.js as React components; the scene graph is shareable with mobile |
| Mobile | Expo / React Native | One codebase for iOS and Android, and it can run the same scene |
| API | Fastify | Fast, small, first-class TypeScript |
| Database | Postgres + Drizzle | Relational state with type-safe queries and real migrations |
| Model | Claude `claude-opus-5` | Planning quality decides how well every agent below it spends its time |
| Realtime | WebSocket | Server pushes; clients never poll for agent state |
| Jobs | Durable queue (Redis-backed) | Work must survive the browser closing |

## 5. Data model

Full schema: `apps/api/src/db/schema.ts`.

```
workspaces ──┬── workspace_members ── users
             ├── connections          (OAuth tokens, encrypted at rest)
             ├── uploads              (user files, available to agents)
             └── goals
                   ├── plans ── tasks ── agent_runs ── tool_calls
                   ├── approvals       (consequential actions awaiting a human)
                   ├── artifacts       (the outputs the user receives)
                   └── world_events    (append-only; the replay log)
```

Two invariants:

**Every user-data row carries `workspaceId`.** Tenant isolation is a property
of the row, not of the query that happens to be written correctly.

**Execution history is append-only.** A retry creates a new `agent_runs` row
rather than overwriting the failed one, so the audit trail records what
actually happened, including the parts that went wrong.

## 6. How a goal executes

1. User submits a goal. → `goals` row, state `submitted`.
2. Orchestrator plans it (`orchestrator/planner.ts`), using structured output
   so the plan arrives already valid rather than as prose we must parse.
3. The plan is **validated before anything runs** — unknown agents, unknown
   dependencies, self-references and cycles are all rejected here. A bad plan
   becomes one clear error at plan time instead of a task that silently never
   starts.
4. Tasks are grouped into **waves**. Wave 0 is everything with no dependencies
   and runs in parallel; wave N runs once N−1 completes. This is what lights
   several robots at once instead of marching through them one at a time.
5. Each task dispatches to its agent with only the tools that agent is
   permitted and only the context it needs.
6. Every tool call passes the permission gate (§7).
7. Results return to the Orchestrator, which synthesises the final answer.
8. Every transition emits an event (§8).

## 7. The permission gate

One function decides whether any agent may act: `decide()` in
`packages/shared/src/domain/permissions.ts`. Every tool call goes through it.

| Effect | Behaviour |
|---|---|
| `read`, `analyse`, `draft` | Autonomous. Never asks. |
| `external_send`, `external_write` | Asks, unless the workspace granted this action type |
| `financial`, `destructive` | **Always** asks. Not waivable at any autonomy level. |

Drafting an email is autonomous; sending it is not. The line is drawn at
actions a user cannot take back: things other people can see, money, and
deletion.

Workspaces choose between `ask_always` (default), `ask_once_per_type`
("don't ask again"), and `autonomous`. Financial and destructive actions stop
regardless of the setting — those two have no undo, so no setting waives them.

The gate is pure and small on purpose. An approval gate that is hard to read
is an approval gate nobody trusts.

## 8. Real-time state

Protocol: `packages/shared/src/events/protocol.ts`. Bus: `apps/api/src/realtime/bus.ts`.

Events are **facts about the past, never instructions to the UI**. There is no
`camera.focus` event. The backend reports that an agent started working;
whether that moves the camera is the client's decision.

Two properties the bus guarantees:

- **Total order.** Sequence numbers are assigned in the bus, one at a time per
  goal, so two agents finishing in the same millisecond still produce an order
  every client agrees on. Out-of-order arrivals are dropped, never applied.
- **Persist, then broadcast.** An event is durable before anyone sees it. The
  other order would let a crash between send and save leave clients showing
  work the server has no record of.

A client reconnects by sending the last `seq` it applied and receiving the gap.
Refreshing the page does not lose the world.

## 9. Security

- Integration tokens are encrypted at rest and **never** leave the API process.
  The 3D client is told Gmail is connected; it is never told how to reach it.
- Agents receive only the tools their task needs — capability, not ambient access.
- `tool_calls` records the permission decision next to the action, so the audit
  trail cannot disagree with itself.
- Raw tool arguments are deliberately not stored. They contain message bodies
  and addresses we have no reason to keep.

## 10. Phase plan

**Phase 1 (current)** — one vertical slice, real end to end:
Orchestrator + Email Agent + Calendar Agent + Slack Agent. Real OAuth, real
data, real persisted state, and the island driven by that state.

**Phase 2** — Finance, Research, CRM and Documents agents, once Phase 1 is
stable under real use.

Agents are added by appending to the registry in
`packages/shared/src/agents/registry.ts`. One entry defines an agent's role,
instructions, tools and island zone; the backend and the 3D world both read it,
so they cannot drift apart.

## 11. Known external dependencies

**Google OAuth verification.** Gmail and Calendar scopes are restricted.
Google's review is an external process measured in weeks and is not under our
control. We build against test accounts and submit early so the review runs in
parallel with development rather than after it.

**Slack app review** applies if we distribute publicly rather than by workspace
install.
