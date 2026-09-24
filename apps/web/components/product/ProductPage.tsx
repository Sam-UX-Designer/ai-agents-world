import Link from 'next/link'
import { Logo } from '@/components/brand/Logo'
import { WorldArt } from '@/components/world/Backdrop'
import { Reveal } from './Reveal'
import { ThemeToggle } from './Theme'

/**
 * The product page.
 *
 * This is the first landing page again, which is the one the owner picked.
 * Four things changed from it and nothing else did:
 *
 * 1. The island still carries the hero. That part was already right.
 * 2. The headline is "Ask once. / Watch the AI agents working" - it now says
 *    who is doing the work, which the old one left the reader to guess.
 * 3. The hero is centred rather than sitting in the bottom-left corner.
 * 4. Everything below the hero was flat black. It is a gradient now, with a
 *    dot field and one seam under the hero. Three things, deliberately: the
 *    brief was some elements, not a texture library.
 *
 * Every image is a crop of the supplied island render. That is a constraint
 * from this repo's rules rather than a shortage - the artwork is supplied and
 * never generated - and it is the honest one, because a marketing page
 * showing anything else would be selling a different product.
 *
 * The copy rule throughout is one idea per section, said once, in the
 * shortest true sentence.
 */

const ISLAND = '/world/island-hero.png'

/** The supplied render's own proportions. Crops are measured against it. */
const ART_ASPECT = 1672 / 941

/**
 * A close look at one part of the island.
 *
 * Two goes at this were wrong before the maths went in.
 *
 * The first used an <img> with object-position and a transform. Those do not
 * compose the way you would expect: the scale magnifies about the element's
 * centre after the position has been applied, so crops aimed at opposite ends
 * of the island both landed on the hub.
 *
 * The second used a background position of the fraction to look at, which is
 * also not what that property means. A percentage aligns that point of the
 * IMAGE with the same point of the BOX, so it only centres the target when
 * the target is already at the middle. Aiming at 0.28 down the island
 * actually showed 0.37, which is the hub again.
 *
 * So `at` is the point to put in the middle, and the position that achieves
 * it is worked out here. Solving centre = p(1 - r) + r/2 for p, where r is
 * the box's size as a fraction of the scaled image on that axis.
 */
function Crop({
  at,
  zoom = 2.8,
  box,
  className = '',
}: {
  /** The point of the artwork to centre on, as fractions, like a station. */
  at: readonly [x: number, y: number]
  /** The image's width as a multiple of the box's width. */
  zoom?: number
  /** The box's own aspect, width over height. Needed for the vertical sum. */
  box: number
  className?: string
}) {
  const place = (target: number, ratio: number): number => {
    // A box as big as the image cannot be aimed anywhere; it shows all of it.
    if (ratio >= 1) return 50
    const p = (target - ratio / 2) / (1 - ratio)
    return Math.min(1, Math.max(0, p)) * 100
  }

  const x = place(at[0], 1 / zoom)
  const y = place(at[1], ART_ASPECT / (zoom * box))

  return (
    <span
      className={`pt__crop ${className}`}
      role="img"
      aria-hidden="true"
      style={{
        backgroundImage: `url(${ISLAND.replace(/\.png$/, '.webp')})`,
        backgroundSize: `${zoom * 100}% auto`,
        backgroundPosition: `${x.toFixed(1)}% ${y.toFixed(1)}%`,
      }}
    />
  )
}

export function ProductPage() {
  return (
    <main className="pt">
      <Nav />
      <Hero />

      {/*
        Everything below the hero shares one painted canvas rather than each
        section carrying its own background. That is what keeps the gradient
        continuous: a glow that restarts at every section boundary reads as
        banding, not as light.
      */}
      <div className="pt__canvas">
        <Problem />
        <WhatIsAnAgent />
        <HowItWorks />
        <WhyNow />
        <TheWorld />
        <Plans />
        <Start />
        <Foot />
      </div>
    </main>
  )
}

/**
 * One line across the top, and it scrolls away.
 *
 * It does not stick: on a page whose hero is a photograph, a bar pinned over
 * the view is a window frame over the thing you came to look at.
 */
function Nav() {
  return (
    <nav className="pt__nav">
      <span className="pt__brand">
        <Logo />
        <span>AI Agents World</span>
      </span>
      <div className="pt__navlinks">
        <ThemeToggle />
        <Link href="/pricing">Plans</Link>
        <Link href="/signin" className="pt__btn pt__btn--small">
          Get started
        </Link>
      </div>
    </nav>
  )
}

/**
 * The island, full bleed, with the promise centred over it.
 *
 * The artwork is the argument. Every competitor's page at this point is a
 * headline over a gradient, and this product genuinely has a place to show.
 */
function Hero() {
  return (
    <header className="pt__hero">
      <div className="pt__heroart">
        <WorldArt src={ISLAND} className="pt__heroimg" />
      </div>

      <div className="pt__herotext">
        <h1>
          Ask once.
          <br />
          Watch the AI
          {/*
            The second break only exists below 760px, where the sentence no
            longer fits on one line. It is written rather than left to the
            browser because neither `balance` nor `pretty` would take it:
            both were tried on a 390px screen and both left "working" alone
            on a line of its own. A written break puts it where a person
            would put it.
          */}
          <br className="pt__brk" /> agents working
        </h1>
        <p>
          You give one goal. It is split into tasks, handed to the specialist
          agents that fit, and comes back as one answer.
        </p>
        <div className="pt__cta">
          <Link href="/signin" className="pt__btn">
            Get started
          </Link>
          <Link href="/pricing" className="pt__btn pt__btn--quiet">
            See plans
          </Link>
        </div>
      </div>

      {/* The one join the eye actually notices, so it gets a lit edge rather
          than a hard cut from photograph to page. */}
      <span className="pt__seam" aria-hidden="true" />
    </header>
  )
}

/** Why this was built, as the reader's own problem rather than our story. */
function Problem() {
  return (
    <section className="pt__say">
      <Reveal>
        <h2>You do not have a team. You have a list.</h2>
        <p>
          The work that wants six people gets done by one, at night, badly. Not
          because it is hard. Because there is one of you and it is spread
          across an inbox, a calendar, a spreadsheet and four tabs.
        </p>
      </Reveal>
    </section>
  )
}

/**
 * The question the product owner kept being asked, answered plainly.
 *
 * "Agent" is a word this industry uses without defining. Anyone who has to
 * look it up has already left.
 */
function WhatIsAnAgent() {
  return (
    <section className="pt__split">
      <Reveal className="pt__splittext">
        <h2>An agent is a worker you can describe in a sentence.</h2>
        <p>
          Not a chatbot. A worker with a job, a set of tools, and the judgement
          to use them. The Finance one reads your numbers. The Operations one
          lives in your calendar and inbox.
        </p>
        <p>
          You do not pick between them. You say what you want, and the
          Orchestrator picks.
        </p>
      </Reveal>

      <Reveal className="pt__splitart" delay={0.08}>
        {/* The Sales workstation: two robots and a screen, which is what the
            paragraph beside it is describing. */}
        <div className="pt__frame">
          <Crop at={[0.615, 0.275]} zoom={4.6} box={4 / 3} />
        </div>
      </Reveal>
    </section>
  )
}

/**
 * Three moments, as one asymmetric grid rather than three equal cards.
 *
 * The large cell carries the part people do not expect: that the work is
 * visible while it happens.
 */
function HowItWorks() {
  return (
    <section className="pt__bento">
      <Reveal className="pt__bentohead">
        <h2>One sentence in. One answer out.</h2>
      </Reveal>

      <Reveal className="pt__cell pt__cell--wide">
        <div className="pt__cellart">
          {/* The hub itself, which is where the deciding happens. */}
          <Crop at={[0.5, 0.33]} zoom={2.4} box={16 / 10} />
        </div>
        <div className="pt__celltext">
          <h3>It decides who is needed</h3>
          <p>
            The Orchestrator reads your goal, breaks it into tasks, and sends
            each one to the agent whose job it is. Nobody else is woken.
          </p>
        </div>
      </Reveal>

      <Reveal className="pt__cell pt__cell--tint" delay={0.06}>
        <h3>They work at the same time</h3>
        <p>
          Tasks that do not depend on each other run together, so three
          questions take about as long as one.
        </p>
      </Reveal>

      <Reveal className="pt__cell pt__cell--tint" delay={0.12}>
        <h3>Anything that sends, asks first</h3>
        <p>
          Reading is theirs to do. Emailing, posting and scheduling stop and
          wait for you.
        </p>
      </Reveal>
    </section>
  )
}

/** Why this is possible now and was not two years ago. */
function WhyNow() {
  return (
    <section className="pt__editorial">
      <Reveal>
        <blockquote>
          Models stopped being something you talk to. They became something you
          can hand work to.
        </blockquote>
        <p>
          A model that answers questions needs you in the room for every step.
          A model that can plan, choose a tool, check its own result and stop
          when it is unsure does not. That crossed over recently, and almost
          nothing people use every day has been rebuilt around it yet.
        </p>
      </Reveal>
    </section>
  )
}

/**
 * The part that makes people want it, and the promise underneath.
 *
 * The honesty line is the one thing on this page that is a claim about
 * engineering rather than about value, and it is here because it is the
 * hardest thing to get right and the easiest thing to fake.
 */
function TheWorld() {
  return (
    <section className="pt__band">
      <Reveal className="pt__bandart">
        <WorldArt src={ISLAND} className="pt__bandimg" />
      </Reveal>
      <Reveal className="pt__bandtext" delay={0.08}>
        <h2>You can see it happening.</h2>
        <div className="pt__bandcols">
          <p>
            Your workforce lives on an island. A bolt leaves the hub for
            whoever was chosen. That robot moves while it works, and stops when
            it is done.
          </p>
          <p className="pt__note">
            None of it is decoration. A robot is busy because a task is
            genuinely in flight, and the bar moves because a step genuinely
            finished.
          </p>
        </div>
      </Reveal>
    </section>
  )
}

/** A teaser, not the pricing page. One line each, then a link. */
function Plans() {
  return (
    <section className="pt__plans">
      <Reveal>
        <h2>Start free. No card.</h2>
        <p className="pt__planline">
          Five credits a day, every day, on the free plan. One credit is one
          goal, however many agents it takes. Paid plans start at $19 a month.
        </p>
        <Link href="/pricing" className="pt__link">
          See what each plan includes
        </Link>
      </Reveal>
    </section>
  )
}

function Start() {
  return (
    <section className="pt__start">
      <Reveal>
        <Logo />
        <h2>Give it something to do.</h2>
        <Link href="/signin" className="pt__btn">
          Get started
        </Link>
      </Reveal>
    </section>
  )
}

function Foot() {
  return (
    <footer className="pt__foot">
      <span>AI Agents World</span>
      <div>
        <Link href="/pricing">Plans</Link>
        <Link href="/signin">Sign in</Link>
      </div>
    </footer>
  )
}
