import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { beforeEach, test } from 'node:test'
import { eq } from 'drizzle-orm'

process.env.DATABASE_URL ??= 'postgresql://test/test'
process.env.ANTHROPIC_API_KEY ??= 'test-key'
process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString('base64')
process.env.SESSION_SECRET ??= randomBytes(48).toString('base64')

const { freshDatabase, seedGoal, seedWorkspace, schema } = await import('./helpers.js')
const { balanceOf, grantCredits, ledgerFor, refundGoal, spendForGoal } = await import(
  '../billing/wallet.js'
)
const { BILLING_PLANS, getBillingPlan } = await import('@agents-world/shared')

type Db = Awaited<ReturnType<typeof freshDatabase>>
let db: Db

beforeEach(async () => {
  db = await freshDatabase()
})

/*
 * The money paths.
 *
 * Everything else in this codebase can be wrong and be fixed in the next
 * deploy. These cannot: a gate that lets one goal through is a bill, and a
 * refund that fires twice is credits minted from nothing. They are tested
 * against a real Postgres because both bugs live in the SQL, not the
 * TypeScript.
 */

test('a new workspace gets the free plan, and its allowance', async () => {
  const { workspaceId } = await seedWorkspace(db)
  const balance = await balanceOf(workspaceId)

  const free = getBillingPlan('free')
  assert.equal(balance.plan.key, 'free')
  assert.equal(balance.freeLeft, free.goalsPerDay)
  assert.equal(balance.credits, 0, 'nothing is given away as paid credit')
  assert.equal(balance.total, free.goalsPerDay)
})

test('the free allowance runs out, and says when it comes back', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const perDay = getBillingPlan('free').goalsPerDay!

  for (let i = 0; i < perDay; i++) {
    const goalId = await seedGoal(db, workspaceId, userId, `goal ${i}`)
    const spend = await spendForGoal(workspaceId, goalId)
    assert.equal(spend.ok, true, `goal ${i + 1} of ${perDay} is within the allowance`)
  }

  const extra = await seedGoal(db, workspaceId, userId, 'one too many')
  const denied = await spendForGoal(workspaceId, extra)

  assert.equal(denied.ok, false, 'the next one is refused')
  const reason = denied.ok ? '' : denied.reason
  assert.match(reason, /free goals/i, 'and says what ran out')
  assert.match(reason, /hour/i, 'and when it comes back')
  assert.ok(!/error|failed|null/i.test(reason), 'in words, not in database language')

  assert.equal((await balanceOf(workspaceId)).total, 0)
})

test('a plan with no free allowance spends paid credits instead', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  await db.insert(schema.wallets).values({ workspaceId, plan: 'pro', credits: 2 })

  const first = await spendForGoal(workspaceId, await seedGoal(db, workspaceId, userId))
  assert.equal(first.ok, true)
  assert.equal(first.ok && first.from, 'credits')

  const balance = await balanceOf(workspaceId)
  assert.equal(balance.freeLeft, 0, 'a paid plan has no daily free goals')
  // The monthly grant lands on first read, so the balance is the allowance
  // plus what was seeded, less the one just spent.
  assert.equal(balance.credits, getBillingPlan('pro').goalsPerMonth! + 1)
})

test('two goals at the same instant cannot both take the last credit', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  await db.insert(schema.wallets).values({
    workspaceId,
    plan: 'starter',
    credits: 1,
    // Already granted, so the monthly top-up does not refill mid-test.
    periodStartedAt: new Date(),
  })

  const [a, b] = await Promise.all([
    spendForGoal(workspaceId, await seedGoal(db, workspaceId, userId, 'a')),
    spendForGoal(workspaceId, await seedGoal(db, workspaceId, userId, 'b')),
  ])

  const allowed = [a, b].filter((r) => r.ok).length
  assert.equal(allowed, 1, 'exactly one of the two is allowed through')

  const [wallet] = await db
    .select()
    .from(schema.wallets)
    .where(eq(schema.wallets.workspaceId, workspaceId))
  assert.equal(wallet?.credits, 0, 'and the balance never goes negative')
})

test('a refund gives the credit back exactly once', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  await db.insert(schema.wallets).values({
    workspaceId,
    plan: 'starter',
    credits: 3,
    periodStartedAt: new Date(),
  })

  const goalId = await seedGoal(db, workspaceId, userId)
  await spendForGoal(workspaceId, goalId)
  assert.equal((await balanceOf(workspaceId)).credits, 2)

  await refundGoal(workspaceId, goalId, 'nothing ran')
  assert.equal((await balanceOf(workspaceId)).credits, 3, 'the credit comes back')

  // A retry, a duplicate event, a second failure on the same goal - any of
  // them calling refund again must not mint a credit.
  await refundGoal(workspaceId, goalId, 'nothing ran')
  await refundGoal(workspaceId, goalId, 'nothing ran')
  assert.equal((await balanceOf(workspaceId)).credits, 3, 'and only once')
})

test('a refund on a free goal returns the allowance, not a paid credit', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(db, workspaceId, userId)

  const before = await balanceOf(workspaceId)
  await spendForGoal(workspaceId, goalId)
  await refundGoal(workspaceId, goalId, 'nothing ran')
  const after = await balanceOf(workspaceId)

  assert.equal(after.freeLeft, before.freeLeft, 'the free goal is given back')
  assert.equal(after.credits, 0, 'and no paid credit is invented')
})

test('refunding a goal nothing was ever taken for does nothing', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  await db.insert(schema.wallets).values({ workspaceId, plan: 'pro', credits: 5 })
  const before = (await balanceOf(workspaceId)).credits

  await refundGoal(workspaceId, await seedGoal(db, workspaceId, userId), 'never charged')
  assert.equal((await balanceOf(workspaceId)).credits, before)
})

test('every movement is written to the ledger', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(db, workspaceId, userId)

  await spendForGoal(workspaceId, goalId)
  await grantCredits(workspaceId, 50, 'topup', 'pack_50')

  const entries = await ledgerFor(workspaceId)
  const reasons = entries.map((e) => e.reason)

  assert.ok(reasons.includes('free_goal'), 'the goal is recorded')
  assert.ok(reasons.includes('topup'), 'and so is the purchase')

  const topup = entries.find((e) => e.reason === 'topup')
  assert.equal(topup?.delta, 50)
  assert.equal(topup?.balanceAfter, 50, 'the balance after is stored, not recomputed')
})

test('an unknown plan name never grants more than free', async () => {
  const { workspaceId } = await seedWorkspace(db)
  await db.insert(schema.wallets).values({ workspaceId, plan: 'enterprise-unlimited-lol' })

  const balance = await balanceOf(workspaceId)
  assert.equal(balance.plan.key, 'free', 'a name we do not recognise is the cheapest plan')
})

test('every plan is priced above the one below it, and capped', async () => {
  // Not a style check: the pricing page renders these in order, and a plan
  // that costs more while including less is a page nobody buys from.
  for (let i = 1; i < BILLING_PLANS.length; i++) {
    const below = BILLING_PLANS[i - 1]!
    const plan = BILLING_PLANS[i]!
    assert.ok(plan.monthlyUsd > below.monthlyUsd, `${plan.key} costs more than ${below.key}`)
    assert.ok(plan.maxAgents >= below.maxAgents, `${plan.key} allows at least as many agents`)
    assert.ok(plan.yearlyUsd < plan.monthlyUsd, `${plan.key} is cheaper paid yearly`)
  }

  assert.equal(BILLING_PLANS.filter((p) => p.highlighted).length, 1, 'exactly one is recommended')
  assert.ok(BILLING_PLANS.length <= 4, 'four plans at most - more and nobody chooses')
})
