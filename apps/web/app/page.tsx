import Link from 'next/link'
import { Backdrop } from '@/components/world/Backdrop'

/**
 * Landing.
 *
 * Explains the product in the order a person actually asks about it: what do I
 * do, what happens, what do I get. No feature grid - the thing that sells this
 * is the world, and the fastest way to show it is to let them in.
 */
export default function LandingPage() {
  return (
    <main className="landing">
      {/* The island is the product. Showing it before the copy explains it is
          the shortest version of the pitch. */}
      <Backdrop />

      <div className="landing__inner">
        <h1
          style={{
            margin: '0 0 14px',
            fontSize: 'clamp(30px, 7vw, 46px)',
            lineHeight: 1.12,
            fontWeight: 680,
            letterSpacing: '-0.025em',
          }}
        >
          Your AI workforce,
          <br />
          in one world
        </h1>

        <p
          style={{
            margin: '0 auto 34px',
            maxWidth: 440,
            fontSize: 'clamp(14px, 3.4vw, 16px)',
            lineHeight: 1.6,
            color: 'var(--color-text-dim)',
          }}
        >
          Give one goal. An Orchestrator breaks it into tasks and hands them to
          specialist agents. Watch them work, in real time, on a living island.
        </p>

        <div style={{ display: 'grid', gap: 12, maxWidth: 400, margin: '0 auto 40px' }}>
          <Step number="1" title="Connect your tools">
            Gmail, Calendar and Slack. You choose what agents can reach.
          </Step>
          <Step number="2" title="Say what you need">
            In plain words. You never have to pick which agent does what.
          </Step>
          <Step number="3" title="Watch it happen">
            Every robot on the island is a real agent doing real work.
          </Step>
        </div>

        <Link className="btn btn--primary" href="/signin" style={{ padding: '13px 28px' }}>
          Get started
        </Link>

        <p style={{ margin: '26px 0 0', fontSize: 12, color: 'var(--color-text-dim)' }}>
          Agents read and analyse on their own. Sending, posting and deleting
          always ask you first.
        </p>
      </div>
    </main>
  )
}

function Step({
  number,
  title,
  children,
}: {
  number: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div
      className="glass"
      style={{ display: 'flex', alignItems: 'start', gap: 13, padding: 15, textAlign: 'left' }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 25, height: 25, borderRadius: 8, flexShrink: 0,
          display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700,
          background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
          color: 'var(--color-accent)',
        }}
      >
        {number}
      </span>
      <div>
        <p style={{ margin: '0 0 2px', fontSize: 13.5, fontWeight: 600 }}>{title}</p>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text-dim)', lineHeight: 1.5 }}>
          {children}
        </p>
      </div>
    </div>
  )
}
