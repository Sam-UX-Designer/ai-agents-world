'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  BILLING_PLANS,
  TOP_UP_PACKS,
  packSavingPercent,
  type BillingPlan,
} from '@agents-world/shared'

/**
 * Pricing.
 *
 * Four plans, not seven. Every extra column on a pricing page makes the
 * decision slower and the abandonment higher, and four is the most this one
 * can carry while still being answerable at a glance: a free way in, a cheap
 * yes, the one we want people on, and a bigger one above it whose real job is
 * to make that one look reasonable by comparison.
 *
 * Top-ups sit below rather than beside. A top-up is a different decision from
 * a subscription - made once, later, by someone who has already decided they
 * like this - and putting it in the same row would turn a four-way choice
 * into a seven-way one.
 *
 * The unit on this page is a credit, never a goal. A goal is what you type;
 * counting the balance in the same word turns "3 goals left" into something
 * that reads like a to-do list.
 *
 * Nothing here takes money yet. The buttons say so plainly instead of opening
 * a checkout that cannot complete: a payment form that goes nowhere is worse
 * than an honest "not yet", and it is the kind of thing people remember.
 */

export default function PricingPage() {
  const [yearly, setYearly] = useState(false)
  const [asked, setAsked] = useState<string | null>(null)

  return (
    <main className="pricing">
      <header className="pricing__head">
        <Link href="/world" className="pricing__back">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
            <path d="m14 6-6 6 6 6" stroke="currentColor" strokeWidth="1.9"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to the island
        </Link>

        <h1>One goal in. A whole team on it.</h1>
        <p>
          Every plan runs the same world and the same agents. One credit buys one
          goal. What changes is how many credits you get, and how hard the agents
          think.
        </p>

        <div className="pricing__toggle" role="group" aria-label="Billing period">
          <button data-on={!yearly} onClick={() => setYearly(false)}>Monthly</button>
          <button data-on={yearly} onClick={() => setYearly(true)}>
            Yearly <span>2 months free</span>
          </button>
        </div>
      </header>

      <section className="pricing__grid" aria-label="Plans">
        {BILLING_PLANS.map((plan) => (
          <PlanCard
            key={plan.key}
            plan={plan}
            yearly={yearly}
            onChoose={() => setAsked(plan.name)}
          />
        ))}
      </section>

      <section className="pricing__packs" aria-label="Credit packs">
        <h2>Need more this month?</h2>
        <p>
          Top-ups work on any paid plan. Credits never expire, and there is no
          subscription attached.
        </p>
        <ul>
          {TOP_UP_PACKS.map((pack) => {
            const saving = packSavingPercent(pack)
            return (
              <li key={pack.key}>
                <strong>{pack.credits.toLocaleString()} credits</strong>
                <em>${pack.priceUsd}</em>
                {saving > 0 && <span className="pricing__save">Save {saving}%</span>}
                <button className="btn btn--ghost" onClick={() => setAsked(`${pack.credits} credits`)}>
                  Add
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      {asked && (
        <div className="pricing__note" role="status">
          <p>
            <strong>Payments are not open yet.</strong> {asked} is not something we can
            charge you for today - the checkout genuinely does not exist, and a form
            that pretends otherwise would waste your time. The free plan works now,
            and paid plans open as soon as billing is live.
          </p>
          <button className="btn btn--ghost" onClick={() => setAsked(null)}>
            Close
          </button>
        </div>
      )}

      <section className="pricing__faq" aria-label="Questions">
        <Question q="What is one credit?">
          One thing you ask for. The Orchestrator may split it across several
          agents - that is still one credit, however many robots stand up.
        </Question>
        <Question q="What happens when I run out?">
          Nothing breaks and nothing is charged. New goals stop until your free
          credits refresh or you add more. Everything you have already run stays
          in History.
        </Question>
        <Question q="Do I pay for a goal that fails?">
          No. If a run produces nothing, the credit goes straight back - you can
          see it happen in your account.
        </Question>
        <Question q="Can I change plan later?">
          Yes, up or down, and unused credits you have paid for stay yours.
        </Question>
        <Question q="Is my data used to train anything?">
          No. Your goals, mail and messages are yours. Agents read what you
          connect, and nothing leaves for any purpose but the task you asked for.
        </Question>
      </section>

      <p className="pricing__foot">
        Prices in US dollars. Nothing is charged today.
      </p>
    </main>
  )
}

function PlanCard({
  plan,
  yearly,
  onChoose,
}: {
  plan: BillingPlan
  yearly: boolean
  onChoose: () => void
}) {
  const price = yearly ? plan.yearlyUsd : plan.monthlyUsd
  const free = price === 0

  // A month is an abstraction; a day is a thing people can picture. Only worth
  // showing where the number is small enough to sound like nothing.
  const perDay = price > 0 ? (price / 30).toFixed(2) : null

  return (
    <article className="plan" data-highlight={plan.highlighted ? 'true' : undefined}>
      {plan.highlighted && <span className="plan__badge">Most popular</span>}

      <h2>{plan.name}</h2>
      <p className="plan__tagline">{plan.tagline}</p>

      <p className="plan__price">
        {free ? <strong>Free</strong> : <><strong>${price}</strong><span>/month</span></>}
      </p>
      <p className="plan__per">
        {free
          ? 'Forever. No card.'
          : yearly
            ? `Billed yearly · about $${perDay} a day`
            : `About $${perDay} a day`}
      </p>

      <button
        className={plan.highlighted ? 'btn btn--primary' : 'btn btn--ghost'}
        onClick={onChoose}
        style={{ width: '100%' }}
      >
        {free ? 'Start free' : `Choose ${plan.name}`}
      </button>

      <ul className="plan__features">
        {plan.features.map((feature) => (
          <li key={feature}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true">
              <path d="m5 12.5 4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.2"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {feature}
          </li>
        ))}
      </ul>
    </article>
  )
}

function Question({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="pricing__q">
      <summary>{q}</summary>
      <p>{children}</p>
    </details>
  )
}
