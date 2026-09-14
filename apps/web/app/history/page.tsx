'use client'

import { useEffect, useState } from 'react'
import { api, type Me } from '@/lib/api'
import { Chrome } from '@/components/world/Chrome'

/**
 * History.
 *
 * Placeholder while the surface is built. It keeps the same world background
 * and chrome as Home so navigation never drops the user out of the
 * environment - a blank page here would read as the app breaking.
 */
export default function HistoryPage() {
  const [me, setMe] = useState<Me | null>(null)
  useEffect(() => {
    api.me().then(setMe).catch(() => undefined)
  }, [])

  return (
    <main>
      <div className="world" aria-hidden="true">
        <img className="world__art" src="/world/island-hero.png" alt="" />
        <div className="world__veil" />
      </div>

      <Chrome user={me ? { name: me.user.name, plan: 'Pro plan' } : null} />

      <div
        className="glass"
        style={{
          position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          zIndex: 30, padding: 28, textAlign: 'center', maxWidth: 380,
        }}
      >
        <h1 style={{ margin: '0 0 6px', fontSize: 19, fontWeight: 640 }}>History</h1>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-dim)', lineHeight: 1.55 }}>
          Being built next.
        </p>
      </div>
    </main>
  )
}
