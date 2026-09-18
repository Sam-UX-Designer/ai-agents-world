'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'

/**
 * Sign in and create an account.
 *
 * Three ways in, in the order most people will use them: Google, Apple, then
 * an email and password for anyone who would rather not link an account - and
 * for testing, which is the reason it exists at all.
 *
 * Registration asks for everything in one pass. A second screen for a phone
 * number is a second chance to abandon, and nothing here needs verifying
 * before the account can be useful.
 */

type Mode = 'signin' | 'register'
type Theme = 'dark' | 'light'

const THEME_KEY = 'agents-world-theme'

/** Something before an @, something after it, and a dot in the domain. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function SignInPage() {
  const router = useRouter()

  const [theme, setTheme] = useState<Theme>('dark')
  const [mode, setMode] = useState<Mode>('signin')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  // Restore the last choice, then fall back to whatever the device prefers.
  useEffect(() => {
    let stored: string | null = null
    try { stored = window.localStorage.getItem(THEME_KEY) } catch { /* private mode */ }

    const initial: Theme =
      stored === 'light' || stored === 'dark'
        ? stored
        : window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'

    setTheme(initial)
  }, [])

  useEffect(() => {
    // Only this screen themes itself; the world is always dark.
    document.documentElement.dataset.theme = theme
    try { window.localStorage.setItem(THEME_KEY, theme) } catch { /* private mode */ }
    return () => { delete document.documentElement.dataset.theme }
  }, [theme])

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
    <main className="auth">
      <button
        className="auth__theme"
        onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      >
        <SunIcon hidden={theme === 'dark'} />
        <MoonIcon hidden={theme === 'light'} />
      </button>

      <div className="auth__card">
        <h1 className="auth__title">{registering ? 'Create your account' : 'Sign in'}</h1>
        <p className="auth__sub">
          {registering
            ? 'One step. Your AI workforce is ready on the other side.'
            : 'Start building your AI workforce.'}
        </p>

        <div className="auth__socials">
          <button
            className="auth__social"
            onClick={() => void social('google')}
            disabled={busy !== null}
          >
            <GoogleIcon />
            {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
          </button>

          <button
            className="auth__social"
            onClick={() => void social('apple')}
            disabled={busy !== null}
          >
            <AppleIcon />
            {busy === 'apple' ? 'Opening Apple…' : 'Continue with Apple'}
          </button>
        </div>

        <div className="auth__rule">or</div>

        <form className="auth__form" onSubmit={submit}>
          {registering && (
            <label className="auth__field">
              <span>Full name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sam Jo"
                autoComplete="name"
                required
              />
            </label>
          )}

          <label className="auth__field">
            <span>Email address</span>
            <input
              // Deliberately text, not email: the browser's own bubble cannot
              // be styled or placed, and it fires before ours can.
              type="text"
              inputMode="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                // Clear as they correct it. Keeping the error on screen while
                // someone fixes it is nagging, not helping.
                if (emailError) setEmailError(null)
              }}
              placeholder="you@company.com"
              autoComplete="email"
              aria-invalid={emailError !== null}
              aria-describedby={emailError ? 'email-error' : undefined}
              data-invalid={emailError !== null}
              required
            />
            {emailError && (
              <span className="auth__fielderror" id="email-error" role="alert">
                {emailError}
              </span>
            )}
          </label>

          {registering && (
            <label className="auth__field">
              <span>Phone number <em style={{ fontStyle: 'normal', opacity: 0.7 }}>Optional</em></span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 90000 00000"
                autoComplete="tel"
              />
            </label>
          )}

          <label className="auth__field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={registering ? 'At least 8 characters' : '••••••••'}
              autoComplete={registering ? 'new-password' : 'current-password'}
              minLength={registering ? 8 : undefined}
              required
            />
          </label>

          <button className="auth__submit" type="submit" disabled={busy !== null}>
            {busy === 'form'
              ? registering ? 'Creating account…' : 'Signing in…'
              : registering ? 'Create account' : 'Sign in'}
          </button>
        </form>

        {error && <p role="alert" className="auth__error">{error}</p>}

        <p className="auth__switch">
          {registering ? 'Already have an account? ' : 'New here? '}
          <button
            type="button"
            onClick={() => {
              setMode(registering ? 'signin' : 'register')
              setError(null)
            }}
          >
            {registering ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </div>
    </main>
  )
}

// ------------------------------------------------------------------ icons --

function SunIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" data-hidden={hidden} aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6L17 17M7 7 5.4 5.4"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      />
    </svg>
  )
}

function MoonIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" data-hidden={hidden} aria-hidden="true">
      <path
        d="M20 13.4A8.2 8.2 0 0 1 10.6 4a8.4 8.4 0 1 0 9.4 9.4Z"
        stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"
      />
    </svg>
  )
}

/** Google's own mark. Brand colours are fixed, so it is identical in both themes. */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path fill="#4285F4" d="M23 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.16a5.27 5.27 0 0 1-2.29 3.46v2.87h3.7C21.72 18.84 23 15.86 23 12.27Z" />
      <path fill="#34A853" d="M12 23.5c3.1 0 5.7-1.03 7.6-2.79l-3.71-2.87c-1.03.69-2.35 1.1-3.89 1.1-2.99 0-5.52-2.02-6.43-4.73H1.73v2.96A11.48 11.48 0 0 0 12 23.5Z" />
      <path fill="#FBBC05" d="M5.57 14.21a6.9 6.9 0 0 1 0-4.41V6.84H1.73a11.5 11.5 0 0 0 0 10.33l3.84-2.96Z" />
      <path fill="#EA4335" d="M12 5.07c1.69 0 3.2.58 4.39 1.72l3.29-3.29C17.7 1.6 15.1.5 12 .5 7.53.5 3.67 3.07 1.73 6.84l3.84 2.96C6.48 7.09 9.01 5.07 12 5.07Z" />
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M16.36 12.62c-.02-2.2 1.79-3.26 1.87-3.31-1.02-1.49-2.6-1.7-3.17-1.72-1.35-.14-2.63.79-3.32.79-.68 0-1.74-.77-2.86-.75-1.47.02-2.83.85-3.59 2.16-1.53 2.65-.39 6.58 1.1 8.73.73 1.05 1.6 2.23 2.75 2.19 1.1-.05 1.52-.71 2.85-.71 1.33 0 1.71.71 2.87.69 1.19-.02 1.94-1.07 2.66-2.13.84-1.22 1.19-2.4 1.21-2.46-.03-.01-2.32-.89-2.34-3.52M14.2 6.2c.6-.74 1.01-1.75.9-2.77-.87.04-1.93.58-2.56 1.31-.56.65-1.05 1.69-.92 2.68.97.08 1.96-.49 2.58-1.22" />
    </svg>
  )
}
