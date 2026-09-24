'use client'

import { useEffect, useState } from 'react'
import { api, type Me } from './api'

/**
 * Who is looking at the app.
 *
 * Someone arriving from a shared link should be able to walk around the
 * product before being asked for an email - see the island, open an agent,
 * read what the tools do - and only meet a sign-in form when they try to
 * actually use it. So "signed out" is a normal state here, not an error, and
 * every screen needs the same answer to the same question.
 *
 * Three states, and the difference between the first two matters: `loading`
 * means we have not asked yet, `guest` means we asked and there is no session.
 * Treating them as one is how a signed-in person gets a flash of the guest
 * chrome on every navigation, and how a guest gets a flash of an empty
 * account.
 *
 * The answer is fetched once per page load and shared. Each screen asking for
 * itself meant three /me calls and three chances for them to disagree.
 */

export type Viewer =
  | { readonly state: 'loading' }
  | { readonly state: 'guest' }
  | { readonly state: 'member'; readonly me: Me }

let pending: Promise<Viewer> | null = null

/**
 * Ask the server, once.
 *
 * A failure of any kind resolves to `guest` rather than rejecting. A signed-in
 * person whose network dropped sees the guest chrome for a moment, which is
 * recoverable; a thrown error would leave every screen stuck on `loading`,
 * which is not.
 */
function resolveViewer(): Promise<Viewer> {
  pending ??= api
    .me()
    .then((me): Viewer => (me.workspace ? { state: 'member', me } : { state: 'guest' }))
    .catch((): Viewer => ({ state: 'guest' }))
  return pending
}

/** Throw away the cached answer, after signing in or out. */
export function forgetViewer(): void {
  pending = null
}

export function useViewer(): Viewer {
  const [viewer, setViewer] = useState<Viewer>({ state: 'loading' })

  useEffect(() => {
    let live = true
    void resolveViewer().then((v) => { if (live) setViewer(v) })
    return () => { live = false }
  }, [])

  return viewer
}

/** Shorthand for the common question, with `loading` counted as not-yet-a-guest. */
export const isGuest = (viewer: Viewer): boolean => viewer.state === 'guest'
