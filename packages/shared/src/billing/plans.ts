/**
 * What each plan includes, in one place.
 *
 * Every number here is a business decision, not an implementation detail, so
 * they live together and are read by the API (to enforce them) and the web app
 * (to display them) from the same source. Changing a price or an allowance is
 * editing this file and nothing else.
 *
 * THE NUMBERS ARE PROVISIONAL. They are sized against an estimate of what a
 * goal costs to run, not a measurement, because nobody has run enough real
 * goals yet to have one. Once `/usage` has a few hundred real runs behind it,
 * the true cost per goal is known and these should be corrected. Treat them as
 * a starting position to argue with, not a decision.
 *
 * The three levers that decide what a plan costs to serve:
 *
 *   model        Opus is roughly five times Haiku per token. This is the
 *                single biggest lever and it is why the free tier is not
 *                simply "the paid product, less often".
 *   maxAgents    Cost scales with how many agents a goal wakes up, so capping
 *                the plan caps the worst case. One credit buys a goal; the cap
 *                is what stops one credit costing eight agents' worth.
 *   goals        The allowance itself.
 */

/** Which Claude model a plan's agents think with. */
export type PlanModel = 'claude-opus-5' | 'claude-sonnet-5' | 'claude-haiku-4-5'

/** How hard the model works before answering. Lower is cheaper and faster. */
export type PlanEffort = 'low' | 'medium' | 'high'

export type PlanKey = 'free' | 'starter' | 'pro' | 'business'

export interface BillingPlan {
  readonly key: PlanKey
  readonly name: string
  /** One line, under the name on the pricing page. */
  readonly tagline: string
  /** US dollars per month, billed monthly. 0 is free. */
  readonly monthlyUsd: number
  /**
   * Per month when paid yearly. Two months free, which is the discount
   * everyone recognises and the one that is easiest to explain.
   */
  readonly yearlyUsd: number
  /** Goals included per month. Null on free, which is a daily allowance. */
  readonly goalsPerMonth: number | null
  /** Goals per day, refreshed every 24h. Only the free plan uses this. */
  readonly goalsPerDay: number | null
  readonly model: PlanModel
  readonly effort: PlanEffort
  /** Most goals a plan may split across this many agents. */
  readonly maxAgents: number
  readonly seats: number
  /** Shown as ticks on the card, in order. */
  readonly features: readonly string[]
  /** Exactly one plan carries this. See the note below. */
  readonly highlighted?: boolean
}

/**
 * Four plans, not seven.
 *
 * More options make people decide slower and abandon more often, and a
 * pricing page is the worst possible place for that. Four is the most a page
 * can carry while still letting someone choose in one glance: a free way in,
 * a cheap yes, the one we actually want them on, and a bigger one above it
 * whose job is to make that one look reasonable.
 *
 * Pro is highlighted because a middle option that is visibly recommended is
 * the one most people take. It is also the one with the best margin, which is
 * the only honest reason to recommend it - if that stops being true, the
 * highlight moves.
 */
export const BILLING_PLANS: readonly BillingPlan[] = [
  {
    key: 'free',
    name: 'Free',
    tagline: 'See what a workforce feels like.',
    monthlyUsd: 0,
    yearlyUsd: 0,
    goalsPerMonth: null,
    goalsPerDay: 5,
    // Haiku, one agent. A free goal has to cost cents, not rupees, or a
    // hundred signups is a bill rather than a pipeline.
    model: 'claude-haiku-4-5',
    effort: 'low',
    maxAgents: 1,
    seats: 1,
    features: [
      '5 goals a day, every day',
      'One agent per goal',
      'Full 3D world and history',
      'No card needed',
    ],
  },
  {
    key: 'starter',
    name: 'Starter',
    tagline: 'For one person with real work.',
    monthlyUsd: 19,
    yearlyUsd: 16,
    goalsPerMonth: 100,
    goalsPerDay: null,
    model: 'claude-sonnet-5',
    effort: 'medium',
    maxAgents: 3,
    seats: 1,
    features: [
      '100 goals a month',
      'Up to 3 agents per goal',
      'Connect Gmail, Calendar and Slack',
      'Agent instructions',
    ],
  },
  {
    key: 'pro',
    name: 'Pro',
    tagline: 'The full workforce, thinking hard.',
    monthlyUsd: 49,
    yearlyUsd: 41,
    goalsPerMonth: 300,
    goalsPerDay: null,
    model: 'claude-opus-5',
    effort: 'high',
    maxAgents: 6,
    seats: 3,
    features: [
      '300 goals a month',
      'Up to 6 agents per goal',
      'Claude Opus on every agent',
      '3 seats included',
      'Priority support',
    ],
    highlighted: true,
  },
  {
    key: 'business',
    name: 'Business',
    tagline: 'A department, not a person.',
    monthlyUsd: 199,
    yearlyUsd: 166,
    goalsPerMonth: 1_500,
    goalsPerDay: null,
    model: 'claude-opus-5',
    effort: 'high',
    maxAgents: 8,
    seats: 10,
    features: [
      '1,500 goals a month',
      'Up to 8 agents per goal',
      '10 seats included',
      'Shared history and audit log',
      'Priority support',
    ],
  },
]

const BY_KEY = new Map(BILLING_PLANS.map((p) => [p.key, p]))

/** Falls back to free, so an unknown plan never grants more than it should. */
export const getBillingPlan = (key: string | null | undefined): BillingPlan =>
  BY_KEY.get((key ?? 'free') as PlanKey) ?? BILLING_PLANS[0]!

/**
 * Top-ups, for the month someone needs more than their plan.
 *
 * Deliberately not a fifth plan. A top-up is a different decision from a
 * subscription - it is made once, under pressure, by someone who has already
 * decided they like the product - and putting it in the same row as the plans
 * would turn a four-way choice into a seven-way one.
 *
 * Bought credits do not expire. An expiring top-up reads as a penalty for
 * buying early, and the support cost of explaining it is worse than the
 * revenue it protects.
 */
export interface TopUpPack {
  readonly key: string
  readonly goals: number
  readonly priceUsd: number
}

export const TOP_UP_PACKS: readonly TopUpPack[] = [
  { key: 'pack_50', goals: 50, priceUsd: 12 },
  { key: 'pack_200', goals: 200, priceUsd: 40 },
  { key: 'pack_600', goals: 600, priceUsd: 99 },
]

/** What one goal costs in a pack, for the "save 31%" line on the page. */
export const packSavingPercent = (pack: TopUpPack): number => {
  const base = TOP_UP_PACKS[0]!
  const basePer = base.priceUsd / base.goals
  const thisPer = pack.priceUsd / pack.goals
  return Math.round((1 - thisPer / basePer) * 100)
}
