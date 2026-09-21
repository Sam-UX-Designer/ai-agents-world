'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { PLAN_LIMIT_MARKER } from '@agents-world/shared'
import { api } from '@/lib/api'
import { useWorld } from '@/lib/store'

/**
 * The answer.
 *
 * This sits directly above the command bar, in the middle of the screen,
 * because that is where the person was looking when they pressed send. The
 * result used to live in the right-hand rail, alongside the agent roster, and
 * the effect was that a user typed a question into the centre of the world and
 * the reply appeared somewhere in their peripheral vision - so the honest
 * report from them was "it gives no response". A reply belongs under the thing
 * you typed into.
 *
 * It also refuses two things. It never claims success when part of the work
 * failed: a green tick over a half-finished job is worse than no tick, because
 * the user stops checking. And when a goal fails it shows the reason, in words
 * - the version of this screen that said "Could not finish. Nothing was
 * completed." and stopped there sent the user looking through History for a
 * sentence that was already in the store.
 */

export function Answer() {
  const summary = useWorld((s) => s.summary)
  const goalState = useWorld((s) => s.goalState)
  const goalError = useWorld((s) => s.goalError)
  const goalPrompt = useWorld((s) => s.goalPrompt)
  const artifacts = useWorld((s) => s.artifacts)
  const tasks = useWorld((s) => s.tasks)
  const reset = useWorld((s) => s.reset)

  const [openArtifact, setOpenArtifact] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const failed = goalState === 'failed'
  const taskList = Object.values(tasks)
  const unfinished = taskList.filter(
    (t) => t.state === 'failed' || t.state === 'cancelled',
  )
  const complete = unfinished.length === 0 && goalState === 'completed'

  // Nothing to say yet. The progress card is carrying the run until there is.
  if (!summary && !failed) return null

  const copy = async () => {
    if (!summary) return
    try {
      await navigator.clipboard.writeText(summary)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // A clipboard the browser refuses is not worth an error dialog - the
      // text is on screen and selectable either way.
    }
  }

  return (
    <section className="answer glass" aria-live="polite" aria-label="Answer">
      <header className="answer__head">
        <span className="answer__mark" data-tone={failed ? 'bad' : complete ? 'good' : 'part'}>
          {failed ? '!' : complete ? '✓' : '~'}
        </span>
        <div className="answer__title">
          <strong>{failed ? 'Could not finish' : complete ? 'Answer' : 'Partly done'}</strong>
          {goalPrompt && <em>{goalPrompt}</em>}
        </div>
        <button className="answer__close" onClick={reset} aria-label="Clear this answer">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
            <path d="m6.5 6.5 11 11m0-11-11 11" stroke="currentColor" strokeWidth="1.9"
              strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="answer__scroll">
        {failed && (
          <p className="answer__error" role="alert">
            {goalError ?? 'Something went wrong and no agent could start.'}
            {/* A refusal that says "move up a plan" and then leaves the user
                to find the page is a dead end. The planner writes the phrase,
                shared owns it, and this is where it earns a link. */}
            {goalError?.includes(PLAN_LIMIT_MARKER) && (
              <Link href="/pricing" className="answer__plans">
                See plans
              </Link>
            )}
          </p>
        )}

        {/* Named rather than folded into the text, so a user skimming still
            sees what did not happen. */}
        {unfinished.length > 0 && (
          <ul className="answer__unfinished">
            {unfinished.map((task) => (
              <li key={task.id}>
                <strong>{task.title}</strong>
                <em>{task.state === 'cancelled' ? 'you declined this' : task.error ?? 'failed'}</em>
              </li>
            ))}
          </ul>
        )}

        {summary && <p className="answer__text">{summary}</p>}

        {artifacts.length > 0 && (
          <ul className="answer__files">
            {artifacts.map((artifact) => (
              <li key={artifact.artifactId}>
                <div className="answer__file">
                  <span>{artifact.title}</span>
                  <button
                    onClick={() =>
                      setOpenArtifact(
                        openArtifact === artifact.artifactId ? null : artifact.artifactId,
                      )
                    }
                    aria-expanded={openArtifact === artifact.artifactId}
                  >
                    {openArtifact === artifact.artifactId ? 'Hide' : 'View'}
                  </button>
                  <a href={api.artifactDownloadUrl(artifact.artifactId)} download>
                    Save
                  </a>
                </div>
                {openArtifact === artifact.artifactId && (
                  <ArtifactBody id={artifact.artifactId} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="answer__foot">
        {summary && (
          <button className="btn btn--ghost" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
        <button className="btn btn--primary" onClick={reset}>
          Ask something else
        </button>
      </footer>
    </section>
  )
}

/** Loads an artifact's content on demand rather than with the answer. */
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
      <p className="answer__error" role="alert">
        {error}
      </p>
    )
  }

  return <pre className="answer__body">{content ?? 'Loading…'}</pre>
}
