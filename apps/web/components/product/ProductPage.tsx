import Link from 'next/link'
import { Logo } from '@/components/brand/Logo'
import { Reveal } from './Reveal'
import { ThemeToggle } from './Theme'

/**
 * The product page.
 *
 * Rebuilt from research rather than taste, after two attempts that were
 * neither. What the research changed, concretely:
 *
 * - A visitor has about five seconds to answer three questions: what is this,
 *   who is it for, what do I do next. The earlier drafts answered the first
 *   and neither of the others.
 * - The headline should be the clearest sentence a customer would use to
 *   describe the PROBLEM, not a description of the product. "A workforce you
 *   can give one sentence to" was the product describing itself.
 * - One primary call to action beats two competing ones, with the reassurance
 *   sitting next to it rather than three sections away.
 * - The order is an argument: what is wrong, what you get, how it works, why
 *   trust it, what it costs, what you are still wondering, act. Each section
 *   answers the question the last one raises.
 * - Restraint everywhere, with one deliberate moment of visual impact. The
 *   earlier drafts had four pictures competing to be that moment.
 *
 * Every image is a screen of the running product. There are no invented
 * numbers and no customer logos, because there are no customers yet, and
 * borrowing credibility is the one thing this product is built not to do.
 */

const SHOT = {
  working: '/product/03-working.webp',
  dispatch: '/product/02-dispatch.webp',
  ask: '/product/06-ask.webp',
  tools: '/product/04-tools.webp',
  history: '/product/05-history.webp',
}

export function ProductPage() {
  return (
    <main className="pt">
      <Bar />
      <Hero />
      <Shift />
      <Gains />
      <How />
      <Trust />
      <Cost />
      <Questions />
      <Close />
      <Foot />
    </main>
  )
}

function Bar() {
  return (
    <header className="pt__bar">
      <span className="pt__brand">
        <Logo />
        <span>AI Agents World</span>
      </span>
      <div className="pt__baractions">
        <ThemeToggle />
        <Link href="/signin" className="pt__btn pt__btn--sm">Start free</Link>
      </div>
    </header>
  )
}

/**
 * Five seconds to say what is wrong, who it is for, and what to press.
 *
 * One button, with the thing that removes the risk of pressing it written
 * directly underneath rather than buried on the pricing page.
 */
function Hero() {
  return (
    <section className="pt__hero">
      {/*
        The headline takes the whole width, and the rest of the hero sits
        under it in two columns.

        It started beside the screenshot and broke into six lines: the
        sentence needs about sixteen times the font size in width, which is
        700px at the size a hero headline wants to be, and the column was 514.
        A headline either gets the room its scale needs or it gets a smaller
        scale. This gets the room.
      */}
      <Reveal className="pt__herohead">
        <h1>
          Your AI answers questions.
          <br />
          It should be doing the work.
        </h1>
      </Reveal>

      <div className="pt__herobody">
      <Reveal className="pt__herotext">
        <p className="pt__lede">
          Describe what you want done. A team of specialist agents does it, and
          shows you the work as it happens.
        </p>
        <p className="pt__for">For founders and small teams doing the job of six people.</p>
        <div className="pt__cta">
          <Link href="/signin" className="pt__btn pt__btn--big">Start free</Link>
          <span className="pt__reassure">Five credits a day. No card.</span>
        </div>
      </Reveal>

      <Reveal className="pt__heroshot" delay={0.1}>
        <img
          src={SHOT.working}
          alt="The app mid-run: two agents marked as working, a panel listing them, and a card counting completed steps."
          fetchPriority="high"
          decoding="async"
        />
      </Reveal>
      </div>
    </section>
  )
}

/** The value, as the difference between two things the reader already knows. */
function Shift() {
  return (
    <section className="pt__shift">
      <Reveal>
        <h2>A chat window hands the work back. This one takes it.</h2>
        <p>
          You ask a question, you get a paragraph, and then you go and do the
          job yourself. You are still the person carrying every result to the
          next step. That is the part this replaces.
        </p>
      </Reveal>
    </section>
  )
}

/** Three outcomes, written as what changes for you, not as what it has. */
function Gains() {
  const gains = [
    {
      h: 'You stop being the bottleneck',
      p: 'Tasks that do not depend on each other run at the same time, so three questions take about as long as one.',
    },
    {
      h: 'You can see who is doing what',
      p: 'Every agent is somewhere on the island, and it moves while it is working. No wondering whether anything is happening.',
    },
    {
      h: 'Nothing goes out without you',
      p: 'Reading is theirs to do. Anything that sends, posts or schedules stops and waits for your yes.',
    },
  ]

  return (
    <section className="pt__gains">
      <Reveal className="pt__gainshead">
        <h2>What changes</h2>
      </Reveal>
      <ul className="pt__gainslist">
        {gains.map((g, i) => (
          <Reveal key={g.h} delay={i * 0.06}>
            <li>
              <h3>{g.h}</h3>
              <p>{g.p}</p>
            </li>
          </Reveal>
        ))}
      </ul>
    </section>
  )
}

/**
 * How it works, and the one moment the page raises its voice.
 *
 * The dispatch runs the full width because a task being handed to an agent is
 * the thing the product is; everything around it stays quiet so it lands.
 */
function How() {
  return (
    <section className="pt__how">
      <Reveal className="pt__howhead">
        <h2>How it works</h2>
      </Reveal>

      <div className="pt__howrow">
        <Reveal className="pt__howtext">
          <h3>Say it the way you would say it to a person</h3>
          <p>
            No choosing an assistant, no template, no form. One line, in your
            own words.
          </p>
        </Reveal>
        <Reveal className="pt__howshot" delay={0.08}>
          <img src={SHOT.ask} alt="The command bar, with four suggested goals beneath it." loading="lazy" decoding="async" />
        </Reveal>
      </div>

      <Reveal className="pt__moment">
        <div className="pt__momenttext">
          <h3>It works out who is needed, and sends the work to them</h3>
          <p>
            An Orchestrator reads your sentence, splits it into tasks, and
            hands each one to the agent whose job it is. You watch the handover
            happen. Nobody else is woken.
          </p>
        </div>
        <img
          src={SHOT.dispatch}
          alt="A bolt of light travelling from the central hub across the island to the agent that was chosen."
          loading="lazy"
          decoding="async"
        />
      </Reveal>

      <Reveal className="pt__howtail">
        <h3>They report back as one answer</h3>
        <p>
          Findings from every agent, merged into one reply, with what each one
          actually found kept in it. If something failed, the answer says so.
        </p>
      </Reveal>
    </section>
  )
}

/**
 * The trust section.
 *
 * Where a page like this would normally put customer logos and a rating.
 * There are no customers yet, so there is nothing true to put there, and the
 * honest substitute is the promise that is hardest to fake.
 */
function Trust() {
  return (
    <section className="pt__trust">
      <Reveal>
        <h2>Nothing on the screen is pretending.</h2>
        <div className="pt__trustgrid">
          <p>
            An agent moves because a task is genuinely running. The bar moves
            because a step genuinely finished. Before there is a plan there is
            nothing to divide by, so it shows nothing rather than a comforting
            number.
          </p>
          <p>
            No integration says it is connected without a real account behind
            it. No answer claims work that did not happen. If a third of your
            goal failed, the reply names the third that failed.
          </p>
        </div>
        <div className="pt__trustshots">
          <img src={SHOT.tools} alt="The tools screen, showing which accounts are actually connected." loading="lazy" decoding="async" />
          <img src={SHOT.history} alt="The history screen, listing every past run and what it produced." loading="lazy" decoding="async" />
        </div>
      </Reveal>
    </section>
  )
}

function Cost() {
  return (
    <section className="pt__cost">
      <Reveal>
        <h2>Free to start, and it stays useful when it is free.</h2>
        <p>
          Five credits a day, every day. One credit is one goal, however many
          agents it takes to finish it. No card to begin.
        </p>
        <Link href="/pricing" className="pt__link">See what each plan includes</Link>
      </Reveal>
    </section>
  )
}

/** The objections, answered where they are actually raised. */
function Questions() {
  const qs = [
    {
      q: 'What is an agent, exactly?',
      a: 'A worker with one job and a set of tools. The Finance one reads your numbers, the Operations one lives in your calendar and inbox. You never pick between them; you say what you want and the Orchestrator picks.',
    },
    {
      q: 'Will it email people without asking me?',
      a: 'No. Reading is its own to do. Anything that sends, posts, schedules or deletes stops and waits for you, and a no is final.',
    },
    {
      q: 'What does one credit actually cover?',
      a: 'One goal, start to finish, however many agents it takes. A goal that wakes four agents costs the same as one that wakes one.',
    },
    {
      q: 'What happens when something fails?',
      a: 'The answer says what failed and what is therefore missing, rather than quietly summarising the parts that worked. A run where nothing landed is refunded.',
    },
    {
      q: 'What does it need access to?',
      a: 'Gmail, Calendar and Slack, connected by you and revocable by you. Nothing appears as connected unless a real account is behind it.',
    },
  ]

  return (
    <section className="pt__qs">
      <Reveal className="pt__qshead">
        <h2>Still wondering</h2>
      </Reveal>
      <div className="pt__qslist">
        {qs.map((item, i) => (
          <Reveal key={item.q} delay={i * 0.04}>
            <details>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

function Close() {
  return (
    <section className="pt__close">
      <Reveal>
        <h2>Give it something to do.</h2>
        <Link href="/signin" className="pt__btn pt__btn--big">Start free</Link>
        <p className="pt__reassure">Five credits a day. No card.</p>
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
