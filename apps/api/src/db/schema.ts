import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Persistent state for AI Agents World.
 *
 * Two rules shape this schema:
 *
 *  1. Every row that holds user data carries `workspaceId`. Tenant isolation
 *     is enforced on the row, not hoped for in the query layer, so a missing
 *     WHERE clause cannot leak one customer's mail into another's island.
 *
 *  2. Execution history is append-only. Tasks and runs record what happened
 *     and when; nothing rewrites the past. That is what makes the audit trail
 *     trustworthy and what lets a reconnecting client replay a goal exactly.
 */

const id = () => uuid('id').primaryKey().defaultRandom()
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

// ---------------------------------------------------------------- tenancy --

export const workspaces = pgTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  /** ask_always | ask_once_per_type | autonomous. See shared/permissions. */
  autonomyLevel: text('autonomy_level').notNull().default('ask_always'),
  /** Action types the user chose to stop being asked about, e.g. "slack.post".
   *  Financial and destructive actions are never eligible, whatever is here. */
  grantedActionTypes: jsonb('granted_action_types').$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
})

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name'),
    avatarUrl: text('avatar_url'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)],
)

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: id(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'), // owner | admin | member
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('workspace_members_unique').on(t.workspaceId, t.userId)],
)

// ------------------------------------------------------------ integrations --

/**
 * A connected third-party account.
 *
 * Tokens are encrypted at rest with a key held only by the API process, and
 * are never sent to any client. The 3D world is told that Gmail is connected;
 * it is never told how to reach it.
 */
export const connections = pgTable(
  'connections',
  {
    id: id(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // google | slack
    /** The account this connects, shown in the UI so a user with two Gmails
     *  can tell which one an agent is reading. */
    accountLabel: text('account_label').notNull(),
    accessTokenEnc: text('access_token_enc').notNull(),
    refreshTokenEnc: text('refresh_token_enc'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Scopes actually granted, which can be narrower than what we asked for.
     *  Checked before dispatch so an agent fails loudly rather than at the API. */
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('connections_unique').on(t.workspaceId, t.userId, t.provider, t.accountLabel)],
)

// ------------------------------------------------------------- orchestration --

export const goals = pgTable(
  'goals',
  {
    id: id(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** Exactly what the user typed. Never rewritten. */
    prompt: text('prompt').notNull(),
    state: text('state').notNull().default('submitted'),
    /** The Orchestrator's final synthesised answer. */
    summary: text('summary'),
    error: text('error'),
    /** Next event sequence number for this goal. The reconnect cursor. */
    nextSeq: integer('next_seq').notNull().default(0),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('goals_workspace_idx').on(t.workspaceId, t.createdAt)],
)

export const plans = pgTable('plans', {
  id: id(),
  goalId: uuid('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  /** How the Orchestrator read the goal, shown before execution begins. */
  interpretation: text('interpretation').notNull(),
  /** Capabilities the goal needed that no enabled agent has. */
  unsupported: jsonb('unsupported').$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
})

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
    goalId: uuid('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    /** The Orchestrator's plan-local id ("t1"), kept for tracing its output. */
    planLocalId: text('plan_local_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    agentKey: text('agent_key').notNull(),
    /** Task ids (ours, not plan-local) this task needs the output of. */
    dependsOn: jsonb('depends_on').$type<string[]>().notNull().default([]),
    /** 0 = runs immediately; N = runs once wave N-1 finished. */
    wave: integer('wave').notNull().default(0),
    state: text('state').notNull().default('pending'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('tasks_goal_idx').on(t.goalId), index('tasks_state_idx').on(t.state)],
)

/**
 * One attempt by one agent at one task.
 *
 * Separate from `tasks` because a task can be retried: each attempt gets its
 * own row, so a retry does not erase the evidence of why the first one failed.
 */
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: id(),
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    goalId: uuid('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    agentKey: text('agent_key').notNull(),
    attempt: integer('attempt').notNull().default(1),
    state: text('state').notNull().default('spawning'),
    /** Structured result handed back to the Orchestrator. */
    result: jsonb('result').$type<Record<string, unknown>>(),
    /** The model conversation, persisted only while paused for approval.
     *  Resuming replays it verbatim so the agent continues mid-thought
     *  rather than restarting and redoing work the user already paid for. */
    conversation: jsonb('conversation').$type<unknown[]>(),
    /** Tool ids the user approved for this run. */
    approvedToolIds: jsonb('approved_tool_ids').$type<string[]>().notNull().default([]),
    error: text('error'),
    completedSteps: integer('completed_steps').notNull().default(0),
    totalSteps: integer('total_steps'),
    /** Token spend, so per-workspace cost is measurable from day one. */
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    startedAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('agent_runs_task_idx').on(t.taskId)],
)

/**
 * Every tool invocation, including the ones we refused.
 *
 * This doubles as the security audit trail the PRD requires, which is why it
 * records the permission decision next to the action rather than in a separate
 * log that could disagree with it.
 */
export const toolCalls = pgTable(
  'tool_calls',
  {
    id: id(),
    runId: uuid('run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    agentKey: text('agent_key').notNull(),
    toolId: text('tool_id').notNull(),
    effect: text('effect').notNull(),
    /** allowed | denied | approved - how this call got past the gate, or didn't. */
    permission: text('permission').notNull(),
    /** Human summary. Raw arguments are deliberately not stored: they contain
     *  message bodies and addresses we have no reason to keep. */
    summary: text('summary').notNull(),
    outcome: text('outcome').notNull(), // succeeded | failed | denied
    error: text('error'),
    durationMs: integer('duration_ms'),
    createdAt: createdAt(),
  },
  (t) => [index('tool_calls_workspace_idx').on(t.workspaceId, t.createdAt)],
)

/** A consequential action waiting on a human decision. */
export const approvals = pgTable(
  'approvals',
  {
    id: id(),
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    goalId: uuid('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    agentKey: text('agent_key').notNull(),
    actionType: text('action_type').notNull(),
    description: text('description').notNull(),
    /** Exactly what would go out, for the user to read before approving. */
    preview: text('preview'),
    state: text('state').notNull().default('pending'), // pending | approved | rejected | expired
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id),
    /** True if the user also chose "don't ask again" for this action type. */
    remembered: boolean('remembered').notNull().default(false),
    createdAt: createdAt(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [index('approvals_pending_idx').on(t.workspaceId, t.state)],
)

export const artifacts = pgTable(
  'artifacts',
  {
    id: id(),
    goalId: uuid('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    kind: text('kind').notNull(), // summary | report | draft | file
    content: text('content'),
    /** Object-storage key when the artifact is a file rather than text. */
    storageKey: text('storage_key'),
    createdAt: createdAt(),
  },
  (t) => [index('artifacts_goal_idx').on(t.goalId)],
)

/**
 * The append-only event log.
 *
 * Every frame the 3D world has ever been sent lives here. A client that
 * reconnects after a dropped connection - or opens the same goal on a phone -
 * replays from its last `seq` and arrives at exactly the state everyone else
 * is looking at. Without this table, a refresh loses the world.
 */
export const worldEvents = pgTable(
  'world_events',
  {
    id: id(),
    goalId: uuid('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('world_events_goal_seq').on(t.goalId, t.seq)],
)

/** Files a user uploaded, available to whichever agent needs them. */
export const uploads = pgTable(
  'uploads',
  {
    id: id(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** Null when uploaded to the workspace generally rather than to one goal. */
    goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    /** Extracted text, so an agent can read the file without re-parsing it. */
    extractedText: text('extracted_text'),
    createdAt: createdAt(),
  },
  (t) => [index('uploads_workspace_idx').on(t.workspaceId, t.createdAt)],
)

// ------------------------------------------------------------------- auth --

/**
 * Server-side sessions.
 *
 * The cookie carries an opaque id; everything meaningful lives here. That way
 * revoking a session is a DELETE that takes effect instantly, rather than
 * waiting for a self-contained token to expire on its own schedule.
 */
export const sessions = pgTable(
  'sessions',
  {
    /** Hash of the cookie value, never the value itself. A leaked database
     *  dump then yields no usable session cookies. */
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** The workspace this session is currently acting in. */
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

/** Federated identities. One user can sign in with Google and Microsoft both. */
export const identities = pgTable(
  'identities',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // google | microsoft | email
    /** The provider's stable id for this user - never the email, which changes. */
    subject: text('subject').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('identities_provider_subject').on(t.provider, t.subject)],
)

/**
 * In-flight OAuth authorisations.
 *
 * Holds the `state` parameter and the PKCE verifier between redirecting the
 * user out and receiving them back. Server-side rather than in a cookie so a
 * CSRF attempt cannot supply its own state, and short-lived because an
 * authorisation that has sat unfinished for ten minutes is not one we want to
 * complete.
 */
export const oauthStates = pgTable(
  'oauth_states',
  {
    state: text('state').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    codeVerifier: text('code_verifier').notNull(),
    /** Where to send the user once the connection succeeds. */
    returnTo: text('return_to'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('oauth_states_expiry_idx').on(t.expiresAt)],
)
