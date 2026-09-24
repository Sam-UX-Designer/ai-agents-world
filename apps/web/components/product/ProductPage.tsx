import Link from 'next/link'
import { Logo } from '@/components/brand/Logo'
import { Reveal } from './Reveal'
import { ThemeToggle } from './Theme'

/**
 * The page the portfolio card links to.
 *
 * It is about the product and nothing else. It answers, in this order, the
 * questions someone actually asks: what is this, what is it for, what was
 * wrong with how this is normally done, how does it work, what makes it
 * different, and how do I try it.
 *
 * It tells that as one story rather than as a feature list: a single goal,
 * from the sentence you type to the answer you get, illustrated with real
 * screens of the running product. Nothing here is a mockup and nothing is a
 * drawing of a screen that does not exist.
 *
 * There are no numbers on this page. The product has not launched, so any
 * figure would be invented, and inventing figures is the exact thing the
 * product was built not to do.
 */

const SHOT = {
  idle: '/product/01-idle.webp',
  dispatch: '/product/02-dispatch.webp',
  working: '/product/03-working.webp',
  tools: '/product/04-tools.webp',
  history: '/product/05-history.webp',
}

export function ProductPage() {
  return (
    <main className="pt">
      <Header />
      <Opening />
      <Why />
      <Step
        n="Type one sentence"
        title="You say what you want, not who should do it."
        body="No picking an assistant, no choosing a template, no filling in a form. One line, the way you would say it to a person who works for you."
        shot={SHOT.idle}
        alt="The island at rest, with every agent standing by and the command bar at the bottom of the screen."
      />
      <Step
        n="It decides who is needed"
        title="The goal is split, and sent to the agents whose job it is."
        body="An Orchestrator reads the sentence, breaks it into tasks, and hands each one out. You watch it happen: a bolt leaves the hub for each agent that was chosen. Nobody else is woken."
        shot={SHOT.dispatch}
        alt="A bolt of light travelling from the central hub across the island to an agent's station."
        wide
      />
      <Step
        n="They work in parallel"
        title="Tasks that do not depend on each other run at the same time."
        body="Three questions take about as long as one. Each agent shows what it is doing in its own words, and the progress bar counts steps that actually finished."
        shot={SHOT.working}
        alt="Two agents marked as working, an active agents panel, and a task card counting completed steps."
      />
      <Honesty />
      <Reach />
      <Try />
      <Foot />
    </main>
  )
}

function Header() {
  return (
    <header className="pt__bar">
      <span className="pt__brand">
        <Logo />
        <span>AI Agents World</span>
      </span>
      <div className="pt__baractions">
        <ThemeToggle />
        <Link href="/signin" className="pt__btn pt__btn--sm">
          Open the app
        </Link>
      </div>
    </header>
  )
}

/** What it is, in the first breath. */
function Opening() {
  return (
    <section className="pt__open">
      <Reveal>
        <p className="pt__kicker">AI Agents World</p>
        <h1>
          A workforce you can
          <br />
          give one sentence to.
        </h1>
        <p className="pt__lede">
          Most AI tools answer a question and hand the work back to you. This
          one takes the work. You describe an outcome, and a team of specialist
          agents goes and does it while you watch.
        </p>
      </Reveal>
    </section>
  )
}

/** The problem, and why it is worth a product. */
function Why() {
  return (
    <section className="pt__why">
      <Reveal className="pt__whytext">
        <h2>The work that needs six people gets done by one.</h2>
        <p>
          A founder, a solo designer, a small team. The job spreads across an
          inbox, a calendar, a spreadsheet and four tabs, and the person doing
          it is the only thing holding the pieces together.
        </p>
        <p>
          A chat window does not fix that. It answers one question at a time
          and leaves you to carry the result to the next thing. You are still
          the integration layer.
        </p>
      </Reveal>
      <Reveal className="pt__whyaside" delay={0.08}>
        <p>
          So the thing to build was not a better chat window. It was somewhere
          the work could be handed over and then seen.
        </p>
      </Reveal>
    </section>
  )
}

/** One beat of the story: a claim, a sentence, and the screen it happened on. */
function Step({
  n,
  title,
  body,
  shot,
  alt,
  wide = false,
}: {
  n: string
  title: string
  body: string
  shot: string
  alt: string
  /**
   * The middle beat runs the screen at full width with its text above it.
   *
   * Two reasons. It is the moment the product is actually about - a task
   * being handed to an agent - and it needs the room to be legible. And three
   * text-beside-picture rows in a row is a rhythm that puts people to sleep
   * however good the pictures are.
   */
  wide?: boolean
}) {
  if (wide) {
    return (
      <section className="pt__wide">
        <Reveal className="pt__widetext">
          <p className="pt__stepn">{n}</p>
          <h2>{title}</h2>
          <p>{body}</p>
        </Reveal>
        <Reveal className="pt__wideshot" delay={0.08}>
          <img src={shot} alt={alt} loading="lazy" decoding="async" />
        </Reveal>
      </section>
    )
  }

  return (
    <section className="pt__step">
      <Reveal className="pt__steptext">
        <p className="pt__stepn">{n}</p>
        <h2>{title}</h2>
        <p>{body}</p>
      </Reveal>
      <Reveal className="pt__stepshot" delay={0.08}>
        {/* A real screen of the running product, not a drawing of one. */}
        <img src={shot} alt={alt} loading="lazy" decoding="async" />
      </Reveal>
    </section>
  )
}

/**
 * The difference that is hard to see and hard to fake.
 *
 * Every product in this category shows something moving while it waits. This
 * one is built so it cannot, and that is worth its own section because it is
 * the reason to trust anything else on the page.
 */
function Honesty() {
  return (
    <section className="pt__honest">
      <Reveal>
        <h2>Nothing on the screen is pretending.</h2>
        <div className="pt__honestgrid">
          <p>
            A robot moves because a task is genuinely in flight. The bar moves
            because a step genuinely finished. Before a plan exists there is
            nothing to divide by, so it shows no percentage rather than a
            comforting one.
          </p>
          <p>
            If an agent fails, the answer says so and names what is missing.
            Nothing integration claims to be connected without a real account
            behind it, and anything that sends, posts or schedules stops and
            asks you first.
          </p>
        </div>
      </Reveal>
    </section>
  )
}

/** What the agents can actually touch, and what is kept. */
function Reach() {
  return (
    <section className="pt__reach">
      <Reveal className="pt__reachhead">
        <h2>Real accounts, and a record of everything.</h2>
        <p>
          Agents work in your Gmail, your Calendar and your Slack, through your
          own connected accounts. Every run is kept: what was asked, who did
          what, what each one found, and what it cost.
        </p>
      </Reveal>
      <div className="pt__reachshots">
        <Reveal>
          <img src={SHOT.tools} alt="The tools screen, showing which integrations are connected." loading="lazy" decoding="async" />
        </Reveal>
        <Reveal delay={0.08}>
          <img src={SHOT.history} alt="The history screen, listing past runs and their results." loading="lazy" decoding="async" />
        </Reveal>
      </div>
    </section>
  )
}

function Try() {
  return (
    <section className="pt__try">
      <Reveal>
        <h2>Give it something to do.</h2>
        <p>Five credits a day on the free plan. One credit is one goal, however many agents it takes.</p>
        <div className="pt__trycta">
          <Link href="/signin" className="pt__btn">Open the app</Link>
          <Link href="/pricing" className="pt__btn pt__btn--quiet">See plans</Link>
        </div>
      </Reveal>
    </section>
  )
}

function Foot() {
  return (
    <footer className="pt__foot">
      <span>AI Agents World</span>
      <Link href="/pricing">Plans</Link>
    </footer>
  )
}
