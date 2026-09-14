'use client'

import { useState } from 'react'
import { api } from '@/lib/api'

export default function SignInPage() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const signIn = async (provider: 'google' | 'microsoft') => {
    setBusy(provider)
    setError(null)
    try {
      const { url } = await api.signInUrl(provider)
      // A full navigation, not a popup: the OAuth consent screen is where a
      // user checks the address bar, and a popup hides the one thing that
      // proves they are really on Google.
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start sign-in')
      setBusy(null)
    }
  }

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div className="glass" style={{ width: '100%', maxWidth: 380, padding: 28 }}>
        <h1 style={{ margin: '0 0 6px', fontSize: 21, fontWeight: 650 }}>Sign in</h1>
        <p style={{ margin: '0 0 24px', fontSize: 13, color: 'var(--color-text-dim)' }}>
          Start building your AI workforce.
        </p>

        <div style={{ display: 'grid', gap: 10 }}>
          <button
            className="btn btn--ghost"
            style={{ width: '100%' }}
            onClick={() => void signIn('google')}
            disabled={busy !== null}
          >
            {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
          </button>
          <button
            className="btn btn--ghost"
            style={{ width: '100%' }}
            onClick={() => void signIn('microsoft')}
            disabled={busy !== null}
          >
            {busy === 'microsoft' ? 'Opening Microsoft…' : 'Continue with Microsoft'}
          </button>
        </div>

        {error && (
          <p role="alert" style={{ margin: '16px 0 0', fontSize: 12.5, color: 'var(--color-danger)' }}>
            {error}
          </p>
        )}

        <p style={{ margin: '24px 0 0', fontSize: 11.5, lineHeight: 1.55, color: 'var(--color-text-dim)' }}>
          Signing in asks only for your name and email. Access to your mail and
          calendar is a separate step, and you choose it.
        </p>
      </div>
    </main>
  )
}
