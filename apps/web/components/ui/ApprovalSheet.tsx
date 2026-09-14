'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import { useWorld } from '@/lib/store'

/**
 * The approval prompt.
 *
 * This is the most important screen in the product. Everything else describes
 * work; this one asks permission for something the user cannot take back.
 *
 * Two rules it follows:
 *   - Show the real content, never a summary. Approving a paraphrase is not
 *     informed consent.
 *   - Never preselect a decision, and never make Approve the easier button to
 *     hit by accident.
 */

/**
 * Action types that can never be waived.
 *
 * Mirrors the server's gate, which refuses these regardless of what the client
 * sends. Repeated here only so the checkbox does not appear and imply a
 * promise the backend will not keep.
 */
const NEVER_WAIVABLE = new Set(['gcal.delete_event'])

export function ApprovalSheet() {
  const approvals = useWorld((s) => s.approvals)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const approval = approvals[0]
  if (!approval) return null

  const waivable = !NEVER_WAIVABLE.has(approval.actionType)

  const decide = async (decision: 'approved' | 'rejected') => {
    setBusyId(approval.id)
    setError(null)
    try {
      await api.resolveApproval(approval.id, decision, waivable && remember)
      setRemember(false)
    } catch (err) {
      // The approval stays on screen so the user can retry. Clearing it on a
      // failed request would leave the agent paused with no way to release it.
      setError(err instanceof Error ? err.message : 'Could not save your decision')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        display: 'grid', placeItems: 'end center',
        padding: 16,
        background: 'color-mix(in srgb, var(--color-ink-900) 55%, transparent)',
        backdropFilter: 'blur(3px)',
      }}
    >
      <div
        className="glass"
        style={{ width: '100%', maxWidth: 520, padding: 22, marginBottom: 'max(16px, env(safe-area-inset-bottom))' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
          <span
            aria-hidden="true"
            style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--color-warn)' }}
          />
          <span
            style={{
              fontSize: 10.5, fontWeight: 700, letterSpacing: '0.09em',
              textTransform: 'uppercase', color: 'var(--color-warn)',
            }}
          >
            Needs your approval
          </span>
        </div>

        <h2 id="approval-title" style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 650 }}>
          {approval.description}
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--color-text-dim)' }}>
          Nothing has been sent. This will only happen if you approve it.
        </p>

        {approval.preview && (
          <pre
            style={{
              margin: '0 0 18px', padding: 14, borderRadius: 12, maxHeight: 260,
              overflow: 'auto', fontSize: 12.5, lineHeight: 1.55,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              background: 'color-mix(in srgb, var(--color-ink-900) 70%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-accent) 14%, transparent)',
              color: 'var(--color-text)',
            }}
          >
            {approval.preview}
          </pre>
        )}

        {waivable ? (
          <label
            style={{
              display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16,
              fontSize: 12.5, color: 'var(--color-text-dim)', cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            Don&apos;t ask again for {approval.actionType.replace(/[._]/g, ' ')}
          </label>
        ) : (
          <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--color-text-dim)' }}>
            Actions that delete data or move money always ask, every time.
          </p>
        )}

        {error && (
          <p role="alert" style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--color-danger)' }}>
            {error}
          </p>
        )}

        {/* Decline sits first in the DOM so it is the first thing a keyboard or
            screen reader user reaches. The consequential button is never the
            default. */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn btn--ghost"
            style={{ flex: 1 }}
            disabled={busyId !== null}
            onClick={() => void decide('rejected')}
          >
            Don&apos;t do it
          </button>
          <button
            className="btn btn--primary"
            style={{ flex: 1 }}
            disabled={busyId !== null}
            onClick={() => void decide('approved')}
          >
            {busyId ? 'Saving…' : 'Approve'}
          </button>
        </div>

        {approvals.length > 1 && (
          <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--color-text-dim)', textAlign: 'center' }}>
            {approvals.length - 1} more waiting after this one
          </p>
        )}
      </div>
    </div>
  )
}
