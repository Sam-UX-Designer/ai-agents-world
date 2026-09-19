import { and, eq, gt, lt, sql } from 'drizzle-orm'
import { getBillingPlan, type BillingPlan } from '@agents-world/shared'
import { db, schema } from '../db/client.js'

/**
 * Credit: what a workspace may spend, and the record of it spending.
 *
 * One rule shapes everything here: the check happens before Claude is called,
 * never after. A balance read once a goal has already run is not a limit, it
 * is a receipt - the money is gone either way. So `spendForGoal` is the gate,
 * it runs in `POST /goals` before the orchestrator starts, and a refusal from
 * it means no model call happens at all.
 *
 * There is no scheduled job behind any of this. Daily resets and monthly
 * grants are applied lazily, the first time a wallet is read after they fall
 * due, because a free Render instance sleeps and a cron that runs only while
 * someone is already awake is not a cron.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const PERIOD_MS = 30 * DAY_MS

export interface Balance {
  readonly plan: BillingPlan
  /** Free goals left today. */
  readonly freeLeft: number
  /** Free goals this plan gives each day. Zero on paid plans. */
  readonly freePerDay: number
  /** Paid credits in hand, carried over and topped up. */
  readonly credits: number
  /** freeLeft + credits. What the user can actually run right now. */
  readonly total: number
  readonly resetsAt: string
}

/**
 * Read a workspace's wallet, creating it and settling anything overdue.
 *
 * Every read goes through here, so a wallet is never observed in a stale
 * state - if the daily clock has rolled over or a month has elapsed since the
 * last grant, that is applied first and the caller sees settled numbers.
 */
async function loadWallet(workspaceId: string) {
  const [existing] = await db()
    .select()
    .from(schema.wallets)
    .where(eq(schema.wallets.workspaceId, workspaceId))
    .limit(1)

  let wallet = existing

  if (!wallet) {
    const [created] = await db()
      .insert(schema.wallets)
      .values({ workspaceId, dailyResetAt: new Date(Date.now() + DAY_MS) })
      // Two requests from a new workspace can race to create the row. The
      // unique index settles it; the loser reads what the winner wrote.
      .onConflictDoNothing()
      .returning()

    wallet =
      created ??
      (
        await db()
          .select()
          .from(schema.wallets)
          .where(eq(schema.wallets.workspaceId, workspaceId))
          .limit(1)
      )[0]
  }

  if (!wallet) throw new Error(`Could not open a wallet for workspace ${workspaceId}`)

  const now = Date.now()
  const plan = getBillingPlan(wallet.plan)

  // The daily allowance. Conditioned on the stored reset time rather than on
  // what this process just read, so two concurrent requests cannot both
  // decide the day has rolled over and hand out two allowances.
  if (wallet.dailyResetAt.getTime() <= now) {
    const [reset] = await db()
      .update(schema.wallets)
      .set({ dailyUsed: 0, dailyResetAt: new Date(now + DAY_MS) })
      .where(
        and(
          eq(schema.wallets.workspaceId, workspaceId),
          lt(schema.wallets.dailyResetAt, new Date(now + 1)),
        ),
      )
      .returning()
    if (reset) wallet = reset
  }

  // The monthly allowance on a paid plan. Granted, not set: credits a user
  // paid for and did not use are theirs, and a plan that silently truncated
  // the balance every month would be taking them back.
  const monthly = plan.goalsPerMonth
  const periodDue =
    monthly !== null &&
    (!wallet.periodStartedAt || wallet.periodStartedAt.getTime() + PERIOD_MS <= now)

  if (periodDue) {
    const [granted] = await db()
      .update(schema.wallets)
      .set({
        credits: sql`${schema.wallets.credits} + ${monthly}`,
        periodStartedAt: new Date(now),
      })
      .where(
        and(
          eq(schema.wallets.workspaceId, workspaceId),
          wallet.periodStartedAt
            ? eq(schema.wallets.periodStartedAt, wallet.periodStartedAt)
            : sql`${schema.wallets.periodStartedAt} is null`,
        ),
      )
      .returning()

    if (granted) {
      wallet = granted
      await record(workspaceId, null, monthly, 'plan_grant', granted.credits, plan.name)
    }
  }

  return wallet
}

/** What the account screen and the command bar show. */
export async function balanceOf(workspaceId: string): Promise<Balance> {
  const wallet = await loadWallet(workspaceId)
  const plan = getBillingPlan(wallet.plan)
  const freePerDay = plan.goalsPerDay ?? 0
  const freeLeft = Math.max(0, freePerDay - wallet.dailyUsed)

  return {
    plan,
    freeLeft,
    freePerDay,
    credits: wallet.credits,
    total: freeLeft + wallet.credits,
    resetsAt: wallet.dailyResetAt.toISOString(),
  }
}

export type SpendResult =
  | { readonly ok: true; readonly from: 'free' | 'credits'; readonly plan: BillingPlan }
  | { readonly ok: false; readonly reason: string; readonly plan: BillingPlan }

/**
 * Take one credit for one goal, or refuse.
 *
 * Both paths are a single conditional UPDATE rather than a read followed by a
 * write. Two goals submitted in the same instant would otherwise both read a
 * balance of one and both be allowed; the condition lives in the statement, so
 * the database decides and exactly one of them wins.
 */
export async function spendForGoal(
  workspaceId: string,
  goalId: string,
): Promise<SpendResult> {
  const wallet = await loadWallet(workspaceId)
  const plan = getBillingPlan(wallet.plan)
  const freePerDay = plan.goalsPerDay ?? 0

  if (freePerDay > 0) {
    const [used] = await db()
      .update(schema.wallets)
      .set({ dailyUsed: sql`${schema.wallets.dailyUsed} + 1` })
      .where(
        and(
          eq(schema.wallets.workspaceId, workspaceId),
          lt(schema.wallets.dailyUsed, freePerDay),
        ),
      )
      .returning()

    if (used) {
      await record(workspaceId, goalId, 0, 'free_goal', used.credits, null)
      return { ok: true, from: 'free', plan }
    }
  }

  const [charged] = await db()
    .update(schema.wallets)
    .set({ credits: sql`${schema.wallets.credits} - 1` })
    .where(and(eq(schema.wallets.workspaceId, workspaceId), gt(schema.wallets.credits, 0)))
    .returning()

  if (charged) {
    await record(workspaceId, goalId, -1, 'paid_goal', charged.credits, null)
    return { ok: true, from: 'credits', plan }
  }

  return { ok: false, reason: outOfCreditMessage(plan, freePerDay, wallet.dailyResetAt), plan }
}

/**
 * Give the credit back.
 *
 * Called when a goal produced nothing. Charging for a run that failed before
 * it did any work is the fastest way to lose someone's trust in a metered
 * product, and it is not worth the one credit.
 */
export async function refundGoal(
  workspaceId: string,
  goalId: string,
  note: string,
): Promise<void> {
  /*
   * Every movement on this goal, not one of them.
   *
   * This read used to take a single row with no ordering, which Postgres is
   * free to answer with whichever row it likes. After the first refund there
   * are two rows for the goal, so the "already refunded?" guard was reading
   * the original charge about as often as the refund and handing out a credit
   * every time it was called. The ledger is small per goal; read it all and
   * decide from facts rather than from whichever row came back first.
   */
  const entries = await db()
    .select({ reason: schema.creditLedger.reason })
    .from(schema.creditLedger)
    .where(
      and(
        eq(schema.creditLedger.workspaceId, workspaceId),
        eq(schema.creditLedger.goalId, goalId),
      ),
    )

  // Already given back. A retry, a duplicate event, or a second failure on
  // the same goal must not mint a credit.
  if (entries.some((e) => e.reason === 'refund')) return

  // Nothing was ever taken for this goal, so there is nothing to give back.
  const charge = entries.find((e) => e.reason === 'free_goal' || e.reason === 'paid_goal')
  if (!charge) return

  if (charge.reason === 'free_goal') {
    const [wallet] = await db()
      .update(schema.wallets)
      .set({ dailyUsed: sql`greatest(${schema.wallets.dailyUsed} - 1, 0)` })
      .where(eq(schema.wallets.workspaceId, workspaceId))
      .returning()
    if (wallet) await record(workspaceId, goalId, 0, 'refund', wallet.credits, note)
    return
  }

  const [wallet] = await db()
    .update(schema.wallets)
    .set({ credits: sql`${schema.wallets.credits} + 1` })
    .where(eq(schema.wallets.workspaceId, workspaceId))
    .returning()

  if (wallet) await record(workspaceId, goalId, 1, 'refund', wallet.credits, note)
}

/** Add bought credits. The one call a payment webhook will make. */
export async function grantCredits(
  workspaceId: string,
  amount: number,
  reason: 'topup' | 'adjustment',
  note: string | null = null,
): Promise<number> {
  await loadWallet(workspaceId)

  const [wallet] = await db()
    .update(schema.wallets)
    .set({ credits: sql`${schema.wallets.credits} + ${amount}` })
    .where(eq(schema.wallets.workspaceId, workspaceId))
    .returning()

  if (!wallet) throw new Error(`No wallet for workspace ${workspaceId}`)
  await record(workspaceId, null, amount, reason, wallet.credits, note)
  return wallet.credits
}

/** The recent statement, newest first. */
export const ledgerFor = (workspaceId: string, limit = 50) =>
  db()
    .select()
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.workspaceId, workspaceId))
    .orderBy(sql`${schema.creditLedger.createdAt} desc`)
    .limit(limit)

async function record(
  workspaceId: string,
  goalId: string | null,
  delta: number,
  reason: string,
  balanceAfter: number,
  note: string | null,
): Promise<void> {
  try {
    await db()
      .insert(schema.creditLedger)
      .values({ workspaceId, goalId, delta, reason, balanceAfter, note })
  } catch (err) {
    // The ledger is a record, not a gate. A write that fails here must not
    // fail the goal the user is paying for - it is logged and moved past.
    console.error('[billing] could not write the ledger', err)
  }
}

/** Says what ran out and what to do about it, in that order. */
function outOfCreditMessage(plan: BillingPlan, freePerDay: number, resetsAt: Date): string {
  if (freePerDay > 0) {
    const hours = Math.max(1, Math.ceil((resetsAt.getTime() - Date.now()) / (60 * 60 * 1000)))
    return (
      `You have used today's ${freePerDay} free goals. ` +
      `You get ${freePerDay} more in about ${hours} hour${hours === 1 ? '' : 's'}, ` +
      'or upgrade for more right now.'
    )
  }
  return (
    `Your ${plan.name} plan has no goals left this month. ` +
    'Add a credit pack or move up a plan to keep going.'
  )
}
