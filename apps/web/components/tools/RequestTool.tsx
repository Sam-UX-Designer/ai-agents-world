'use client'

import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'

/**
 * "Request a tool".
 *
 * The catalogue will always be missing something. Rather than leave that as a
 * dead end, the ask is recorded - which integration, and why - so the roadmap
 * is driven by what people actually reach for.
 */
export function RequestTool({ onClose, prefill }: { onClose: () => void; prefill?: string }) {
  const [name, setName] = useState(prefill ?? '')
  const [reason, setReason] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => {
    first.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed || state === 'sending') return

    setState('sending')
    setError(null)
    try {
      await api.requestTool(trimmed, reason.trim() || undefined)
      setState('sent')
      // Long enough to read the confirmation, short enough not to trap anyone.
      setTimeout(onClose, 1600)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that request')
      setState('idle')
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Request a tool">
      <div className="modal__scrim" onClick={onClose} />

      <div className="modal__panel lg">
        {state === 'sent' ? (
          <div className="modal__done">
            <svg viewBox="0 0 24 24" width="34" height="34" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10.5" fill="var(--color-ok)" opacity=".18" />
              <path d="m7.6 12.3 3 3 5.8-6.3" stroke="var(--color-ok)" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <strong>Request received</strong>
            <p>We track what gets asked for most and build in that order.</p>
          </div>
        ) : (
          <>
            <h2 className="modal__title">Request a tool</h2>
            <p className="modal__sub">
              Tell us what your agents need. We prioritise by what gets asked for most.
            </p>

            <label className="field">
              <span>Tool or service</span>
              <input
                ref={first}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Stripe, Jira, Intercom…"
                maxLength={120}
                onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
              />
            </label>

            <label className="field">
              <span>What would your agents do with it? <em>Optional</em></span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Pull failed payments each morning and summarise them in Slack."
                rows={3}
                maxLength={1000}
              />
            </label>

            {error && <p role="alert" className="modal__error">{error}</p>}

            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
              <button
                className="btn btn--primary"
                onClick={() => void submit()}
                disabled={name.trim().length === 0 || state === 'sending'}
              >
                {state === 'sending' ? 'Sending…' : 'Send request'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
