'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Logo } from '@/components/brand/Logo'

/**
 * The moment a guest is asked to sign in.
 *
 * Not a wall at the front door. Someone arriving from a shared link can walk
 * the whole product first - the island, an agent, what the tools do - and
 * meets this only when they try to make something happen. By then they know
 * what they would be signing up for, which is the entire point.
 *
 * It says which action it interrupted. "Sign in to continue" over a screen
 * someone was reading tells them nothing; "Sign in to send this to your
 * agents" tells them what they get back.
 *
 * Dismissable, deliberately. A guest who changes their mind should land back
 * on the product rather than on a form they cannot leave - the trap this
 * whole change exists to remove.
 */

/**
 * Where a half-finished action waits while its owner signs in.
 *
 * sessionStorage, not the URL: a typed goal can be long, private, and is
 * nobody's business in a browser history entry or a server log. It is read
 * back once and cleared.
 */
const PARKED = 'agents-world-parked-prompt'

export function parkPrompt(text: string): void {
  try {
    if (text.trim()) sessionStorage.setItem(PARKED, text)
  } catch {
    // A private window refuses this. Losing the draft is a worse sign-in, not
    // a broken one, so it is never worth failing the action over.
  }
}

/** Take back what was typed before signing in. Returns '' when there is none. */
export function takeParkedPrompt(): string {
  try {
    const text = sessionStorage.getItem(PARKED) ?? ''
    if (text) sessionStorage.removeItem(PARKED)
    return text
  } catch {
    return ''
  }
}

export function SignInGate({
  /** What they were trying to do, finishing "Sign in to ...". */
  action,
  /** One line on what signing in gets them. */
  detail,
  onClose,
}: {
  action: string
  detail?: string
  onClose: () => void
}) {
  const router = useRouter()

  // Escape closes it. A dialog that traps someone is the thing this replaces.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const go = useCallback(
    (mode: 'register' | 'signin') => router.push(`/signin?mode=${mode}`),
    [router],
  )

  /*
   * Rendered at the top of the document, not where it is written.
   *
   * Every surface this can be raised from - the command bar, the tools panel,
   * the agent panel - is a `.glass` element, and `backdrop-filter` makes an
   * element a containing block for `position: fixed` descendants. So the
   * overlay was being laid out inside the bar that raised it: clipped, and
   * with parts of it that could not be clicked. Measured, not guessed - the
   * dismiss button resolved and then timed out waiting to be clickable.
   *
   * Mounted after the first render, because there is no document on the
   * server.
   */
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => setHost(document.body), [])
  if (!host) return null

  return createPortal(
    <div
      className="gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gate-title"
      // A click on the backdrop, not on the card, closes it.
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="gate__card glass">
        <Logo size={44} />
        <h2 id="gate-title" className="gate__title">Sign in to {action}</h2>
        <p className="gate__body">
          {detail ?? 'Your agents need an account to work in. It takes a moment, and the free plan needs no card.'}
        </p>

        <div className="gate__actions">
          <button className="btn btn--primary gate__go" onClick={() => go('register')}>
            Create a free account
          </button>
          <button className="btn btn--ghost gate__go" onClick={() => go('signin')}>
            I already have one
          </button>
        </div>

        <button className="gate__back" onClick={onClose}>
          Keep looking around
        </button>
      </div>
    </div>,
    host,
  )
}
