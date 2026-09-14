'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useWorld } from '@/lib/store'

/**
 * The final result.
 *
 * Two things this screen refuses to do. It never announces success when part
 * of the work failed - a green tick over a half-finished job is worse than no
 * tick at all, because the user stops checking. And every artifact is
 * openable: a summary the user cannot verify is one they have to redo
 * themselves.
 */

export function Results() {
  const summary = useWorld((s) => s.summary)
  const artifacts = useWorld((s) => s.artifacts)
  const tasks = useWorld((s) => s.tasks)
  const goalState = useWorld((s) => s.goalState)
  const reset = useWorld((s) => s.reset)

  const [openArtifact, setOpenArtifact] = useState<string | null>(null)

  const taskList = Object.values(tasks)
  const failed = taskList.filter((t) => t.state === 'failed')
  const cancelled = taskList.filter((t) => t.state === 'cancelled')
  const succeeded = taskList.filter((t) => t.state === 'succeeded')

  // Complete only when nothing was left behind. Anything else is partial, and
  // says so.
  const complete = failed.length === 0 && cancelled.length === 0 && goalState === 'completed'

  if (!summary && goalState !== 'failed') return null

  return (
    <section className="glass" style={{ padding: 20 }} aria-label="Result">
      <header style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14 }}>
        <Mark complete={complete} failedEntirely={goalState === 'failed'} />
        <div>
          <h2 style={{ margin: 0, fontSize: 15.5, fontWeight: 650 }}>
            {goalState === 'failed'
              ? 'Could not finish'
              : complete
                ? 'Done'
                : 'Partly done'}
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-text-dim)' }}>
            {goalState === 'failed'
              ? 'Nothing was completed.'
              : complete
                ? `${succeeded.length} task${succeeded.length === 1 ? '' : 's'} finished`
                : `${succeeded.length} of ${taskList.length} tasks finished`}
          </p>
        </div>
      </header>

      {/* Named explicitly rather than folded into the summary, so a user
          skimming the result still sees what did not happen. */}
      {(failed.length > 0 || cancelled.length > 0) && (
        <div
          style={{
            margin: '0 0 14px', padding: 12, borderRadius: 11, fontSize: 12.5,
            background: 'color-mix(in srgb, var(--color-warn) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-warn) 28%, transparent)',
          }}
        >
          <p style={{ margin: '0 0 6px', fontWeight: 600, color: 'var(--color-warn)' }}>
            Not everything finished
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
            {failed.map((task) => (
              <li key={task.id} style={{ color: 'var(--color-text-dim)' }}>
                {task.title} — {task.error ?? 'failed'}
              </li>
            ))}
            {cancelled.map((task) => (
              <li key={task.id} style={{ color: 'var(--color-text-dim)' }}>
                {task.title} — you declined this
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary && (
        <p style={{ margin: '0 0 16px', fontSize: 13.5, lineHeight: 1.62, whiteSpace: 'pre-wrap' }}>
          {summary}
        </p>
      )}

      {artifacts.length > 0 && (
        <>
          <h3
            style={{
              margin: '0 0 9px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.09em',
              textTransform: 'uppercase', color: 'var(--color-text-dim)',
            }}
          >
            Outputs
          </h3>
          <ul style={{ margin: '0 0 16px', padding: 0, listStyle: 'none', display: 'grid', gap: 7 }}>
            {artifacts.map((artifact) => (
              <li key={artifact.artifactId}>
                <div
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px',
                    borderRadius: 10, fontSize: 12.5,
                    background: 'color-mix(in srgb, var(--color-ink-900) 45%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--color-accent) 12%, transparent)',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {artifact.title}
                  </span>
                  <button
                    className="btn btn--ghost"
                    style={{ padding: '4px 10px', fontSize: 11.5 }}
                    onClick={() =>
                      setOpenArtifact(openArtifact === artifact.artifactId ? null : artifact.artifactId)
                    }
                    aria-expanded={openArtifact === artifact.artifactId}
                  >
                    {openArtifact === artifact.artifactId ? 'Hide' : 'View'}
                  </button>
                  <a
                    className="btn btn--ghost"
                    style={{ padding: '4px 10px', fontSize: 11.5, textDecoration: 'none' }}
                    href={api.artifactDownloadUrl(artifact.artifactId)}
                    download
                  >
                    Save
                  </a>
                </div>
                {openArtifact === artifact.artifactId && (
                  <ArtifactBody id={artifact.artifactId} />
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <button className="btn btn--primary" style={{ width: '100%' }} onClick={reset}>
        New goal
      </button>
    </section>
  )
}

/** Loads an artifact's content on demand rather than with the result. */
function ArtifactBody({ id }: { id: string }) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const artifact = await api.artifact(id)
      setContent(artifact.content ?? '(empty)')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this')
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  if (error) {
    return (
      <p role="alert" style={{ margin: '7px 0 0', fontSize: 12, color: 'var(--color-danger)' }}>
        {error}
      </p>
    )
  }

  return (
    <pre
      style={{
        margin: '7px 0 0', padding: 12, borderRadius: 10, maxHeight: 220, overflow: 'auto',
        fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        background: 'color-mix(in srgb, var(--color-ink-900) 70%, transparent)',
        border: '1px solid color-mix(in srgb, var(--color-accent) 12%, transparent)',
        color: 'var(--color-text)',
      }}
    >
      {content ?? 'Loading…'}
    </pre>
  )
}

function Mark({ complete, failedEntirely }: { complete: boolean; failedEntirely: boolean }) {
  const tone = failedEntirely
    ? 'var(--color-danger)'
    : complete
      ? 'var(--color-ok)'
      : 'var(--color-warn)'

  return (
    <span
      aria-hidden="true"
      style={{
        width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
        display: 'grid', placeItems: 'center', fontSize: 16, fontWeight: 700,
        background: `color-mix(in srgb, ${tone} 18%, transparent)`,
        border: `1.5px solid ${tone}`,
        color: tone,
      }}
    >
      {failedEntirely ? '!' : complete ? '✓' : '~'}
    </span>
  )
}
