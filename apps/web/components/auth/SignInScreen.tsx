'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { Backdrop } from '@/components/world/Backdrop'

/**
 * The front door: what the product is, and the way in, on one screen.
 *
 * There used to be two. A landing page that said "Your AI workforce, in one
 * world" with a Get started button, and a sign-in page that said the same
 * thing again with a card on it. Nobody read the first one twice - they
 * clicked through it - so it was a step that existed to be skipped. The pitch
 * now sits beside the form: you can read it or ignore it, and either way you
 * are already where you sign in.
 *
 * Both `/` and `/signin` render this. Same screen, two doors, so the sign-out
 * redirect and any old link keep working.
 *
 * One theme. The toggle that used to be here meant maintaining a light
 * palette of the whole screen for a choice nobody comes to a sign-in page to
 * make, and it put near-black text over a dark ocean the moment it was used.
 */

type Mode = 'signin' | 'register'

/** Something before an @, something after it, and a dot in the domain. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function SignInScreen() {
  const router = useRouter()

  const [mode, setMode] = useState<Mode>('signin')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const [emailError, setEmailError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')

  /* Already signed in? Go straight in. This also covers the preview
     deployment, where there is no OAuth to run. */
  useEffect(() => {
    api.me().then((me) => { if (me.workspace) router.replace('/world') }).catch(() => undefined)
  }, [router])

  const social = useCallback(async (provider: 'google' | 'apple') => {
    setBusy(provider)
    setError(null)
    try {
      const { url } = await api.signInUrl(provider)
      // A full navigation, not a popup: the consent screen is where a person
      // checks the address bar, and a popup hides the one thing that proves
      // they are really on Google or Apple.
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start sign-in. Please try again.')
      setBusy(null)
    }
  }, [])

  const submit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault()

    /*
     * Check the address ourselves before anything else.
     *
     * type="email" leaves this to the browser, which puts a native bubble
     * over the next field reading "Please include an '@'..." - unstyled,
     * mid-form, and gone the moment you look away. Typing a phone number in
     * there is a common enough mistake to deserve a proper answer.
     */
    if (!EMAIL.test(email.trim())) {
      setEmailError('Please enter a valid email address.')
      setError(null)
      return
    }
    setEmailError(null)

    setBusy('form')
    setError(null)

    try {
      if (mode === 'register') {
        await api.register({ name, email, password, phone: phone.trim() || undefined })
      } else {
        await api.login(email, password)
      }
      router.replace('/world')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setBusy(null)
    }
  }, [mode, name, email, phone, password, router])

  const registering = mode === 'register'

  return (
    <main className="entry">
      <Backdrop veil={false} />
      <div className="entry__veil" aria-hidden="true" />

      <header className="entry__top">
        <span className="entry__brand">
          <span className="entry__mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none">
              <path d="m12 3.2 8.2 16.4a.7.7 0 0 1-.63 1.02H4.43a.7.7 0 0 1-.63-1.02L12 3.2Z"
                stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="entry__brandtext">
            <strong>AI Agents World</strong>
            <em>Think it. Delegate it. Get it done.</em>
          </span>
        </span>

        <p className="entry__switch">
          {registering ? 'Already have an account? ' : 'New here? '}
          <button
            type="button"
            onClick={() => { setMode(registering ? 'signin' : 'register'); setError(null) }}
          >
            {registering ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </header>

      <div className="entry__body">
        {/* The pitch. Read it or skip it - either way the form is already
            on screen, which is the whole reason this is one page. */}
        <section className="entry__pitch">
          <p className="entry__eyebrow">Human ideas. AI execution.</p>

          <h1 className="entry__headline">
            Your AI workforce,
            <br />
            <span>in one world</span>
          </h1>

          <p className="entry__lede">
            Give one goal. An Orchestrator breaks it into tasks and hands them to
            specialist agents. Watch them work, in real time, on a living island.
          </p>

          <ul className="entry__points">
            <Point title="Delegate" sub="Say it in plain words. You never pick the agent." icon={<BoltIcon />} />
            <Point title="Collaborate" sub="Specialists work in parallel, each on its own station." icon={<TeamIcon />} />
            <Point title="Get results" sub="One answer back, with the evidence behind it." icon={<ChartIcon />} />
          </ul>

          <p className="entry__quote">A more capable you, with AI agents.</p>
        </section>

        <section className="entry__card" aria-label={registering ? 'Create your account' : 'Sign in'}>
          <h2>{registering ? 'Create your account' : 'Sign in'}</h2>
          <p className="entry__cardsub">
            {registering
              ? 'One step. Your AI workforce is ready on the other side.'
              : 'Start building your AI workforce.'}
          </p>

          <div className="entry__socials">
            <button onClick={() => void social('google')} disabled={busy !== null}>
              <GoogleIcon />
              {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
            </button>
            <button onClick={() => void social('apple')} disabled={busy !== null}>
              <AppleIcon />
              {busy === 'apple' ? 'Opening Apple…' : 'Continue with Apple'}
            </button>
          </div>

          <div className="entry__rule">or</div>

          <form className="entry__form" onSubmit={submit}>
            {registering && (
              <label className="entry__field">
                <span>Full name</span>
                <span className="entry__input">
                  <UserIcon />
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Sam Jo"
                    autoComplete="name"
                    required
                  />
                </span>
              </label>
            )}

            <label className="entry__field">
              <span>Email address</span>
              <span className="entry__input" data-invalid={emailError !== null}>
                <MailIcon />
                <input
                  // Deliberately text, not email: the browser's own bubble
                  // cannot be styled or placed, and it fires before ours can.
                  type="text"
                  inputMode="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    // Clear as they correct it. Keeping the error up while
                    // someone fixes it is nagging, not helping.
                    if (emailError) setEmailError(null)
                  }}
                  placeholder="you@company.com"
                  autoComplete="email"
                  aria-invalid={emailError !== null}
                  aria-describedby={emailError ? 'email-error' : undefined}
                  required
                />
              </span>
              {emailError && (
                <span className="entry__fielderror" id="email-error" role="alert">
                  {emailError}
                </span>
              )}
            </label>

            {registering && (
              <label className="entry__field">
                <span>Phone number <em>Optional</em></span>
                <span className="entry__input">
                  <PhoneIcon />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 90000 00000"
                    autoComplete="tel"
                  />
                </span>
              </label>
            )}

            <label className="entry__field">
              <span>Password</span>
              <span className="entry__input">
                <LockIcon />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={registering ? 'At least 8 characters' : 'Enter your password'}
                  autoComplete={registering ? 'new-password' : 'current-password'}
                  minLength={registering ? 8 : undefined}
                  required
                />
                {/* Typing a password you cannot see, on a phone, with a
                    minimum length, is how people end up locked out of an
                    account they just created. */}
                <button
                  type="button"
                  className="entry__peek"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  <EyeIcon off={showPassword} />
                </button>
              </span>
            </label>

            <button className="entry__submit" type="submit" disabled={busy !== null}>
              {busy === 'form'
                ? registering ? 'Creating account…' : 'Signing in…'
                : registering ? 'Create account' : 'Sign in'}
            </button>
          </form>

          {error && <p role="alert" className="entry__error">{error}</p>}
        </section>
      </div>

      {/* What the product does, in four words, not a wizard. Nothing here is
          a step you are on - there is no "you are here" marker, because there
          is nothing for it to be true about. */}
      <p className="entry__story" aria-hidden="true">
        <span>Ideas</span>
        <span>Agents</span>
        <span>Execution</span>
        <span>A better tomorrow</span>
      </p>
    </main>
  )
}

function Point({ title, sub, icon }: { title: string; sub: string; icon: React.ReactNode }) {
  return (
    <li>
      <span className="entry__pointicon" aria-hidden="true">{icon}</span>
      <span>
        <strong>{title}</strong>
        <em>{sub}</em>
      </span>
    </li>
  )
}

// ------------------------------------------------------------------ icons --

const BoltIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
    <path d="M13.2 2.6 5 13.4h5.4L9.8 21.4 18.6 10h-5.8l.4-7.4Z" fill="currentColor" />
  </svg>
)

const TeamIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
    <circle cx="9" cy="8.4" r="3.1" stroke="currentColor" strokeWidth="1.7" />
    <circle cx="16.6" cy="9.6" r="2.3" stroke="currentColor" strokeWidth="1.7" />
    <path d="M3.4 19c0-2.8 2.5-4.6 5.6-4.6s5.6 1.8 5.6 4.6" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" />
    <path d="M16.2 14.6c2.4.2 4.4 1.7 4.4 4.4" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" />
  </svg>
)

const ChartIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
    <path d="M5 19V11M12 19V5M19 19v-5" stroke="currentColor" strokeWidth="2.1"
      strokeLinecap="round" />
  </svg>
)

const MailIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
    <rect x="3.2" y="5.4" width="17.6" height="13.2" rx="2.4" stroke="currentColor" strokeWidth="1.6" />
    <path d="m4.4 7.4 7.6 5.4 7.6-5.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

const LockIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
    <rect x="4.6" y="10.4" width="14.8" height="9.6" rx="2.4" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.6 0v2.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

const UserIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
    <circle cx="12" cy="8.4" r="3.4" stroke="currentColor" strokeWidth="1.6" />
    <path d="M5 19.4c0-3.1 3.1-5 7-5s7 1.9 7 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
    <rect x="6.6" y="2.8" width="10.8" height="18.4" rx="2.6" stroke="currentColor" strokeWidth="1.6" />
    <path d="M10.8 18.2h2.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

const EyeIcon = ({ off }: { off: boolean }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
    <path d="M2.6 12S6.2 5.8 12 5.8 21.4 12 21.4 12 17.8 18.2 12 18.2 2.6 12 2.6 12Z"
      stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="2.9" stroke="currentColor" strokeWidth="1.6" />
    {off && <path d="m4.4 4.4 15.2 15.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
  </svg>
)

/** Google's own mark. Brand colours are fixed, so it never re-tints. */
const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
    <path fill="#4285F4" d="M23 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.16a5.27 5.27 0 0 1-2.29 3.46v2.87h3.7C21.72 18.84 23 15.86 23 12.27Z" />
    <path fill="#34A853" d="M12 23.5c3.1 0 5.7-1.03 7.6-2.79l-3.71-2.87c-1.03.69-2.35 1.1-3.89 1.1-2.99 0-5.52-2.02-6.43-4.73H1.73v2.96A11.48 11.48 0 0 0 12 23.5Z" />
    <path fill="#FBBC05" d="M5.57 14.21a6.9 6.9 0 0 1 0-4.41V6.84H1.73a11.5 11.5 0 0 0 0 10.33l3.84-2.96Z" />
    <path fill="#EA4335" d="M12 5.07c1.69 0 3.2.58 4.39 1.72l3.29-3.29C17.7 1.6 15.1.5 12 .5 7.53.5 3.67 3.07 1.73 6.84l3.84 2.96C6.48 7.09 9.01 5.07 12 5.07Z" />
  </svg>
)

const AppleIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M16.36 12.62c-.02-2.2 1.79-3.26 1.87-3.31-1.02-1.49-2.6-1.7-3.17-1.72-1.35-.14-2.63.79-3.32.79-.68 0-1.74-.77-2.86-.75-1.47.02-2.83.85-3.59 2.16-1.53 2.65-.39 6.58 1.1 8.73.73 1.05 1.6 2.23 2.75 2.19 1.1-.05 1.52-.71 2.85-.71 1.33 0 1.71.71 2.87.69 1.19-.02 1.94-1.07 2.66-2.13.84-1.22 1.19-2.4 1.21-2.46-.03-.01-2.32-.89-2.34-3.52M14.2 6.2c.6-.74 1.01-1.75.9-2.77-.87.04-1.93.58-2.56 1.31-.56.65-1.05 1.69-.92 2.68.97.08 1.96-.49 2.58-1.22" />
  </svg>
)
