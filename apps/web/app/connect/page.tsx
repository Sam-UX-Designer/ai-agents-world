'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ProviderDefinition } from '@agents-world/shared'
import { api } from '@/lib/api'

/**
 * Connect tools.
 *
 * Permissions are written as sentences a person can weigh ("Send email (only
 * when you approve it)"), never as raw OAuth scope URLs. A consent screen the
 * user cannot read is not consent.
 */
export default function ConnectPage() {
  const router = useRouter()
  const [providers, setProviders] = useState<ProviderDefinition[]>([])
  const [connected, setConnected] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.providers(), api.me()])
      .then(([list, me]) => {
        setProviders(list)
        setConnected(me.connections.map((c) => c.provider))
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load connectors'),
      )
  }, [])

  const connect = async (id: string) => {
    setBusy(id)
    setError(null)
    try {
      const { url } = await api.connectUrl(id)
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start that connection')
      setBusy(null)
    }
  }

  return (
    <main style={{ minHeight: '100dvh', padding: '40px 20px' }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: 23, fontWeight: 650 }}>Connect your tools</h1>
        <p style={{ margin: '0 0 28px', fontSize: 13.5, color: 'var(--color-text-dim)' }}>
          Your agents can only reach what you connect. You can disconnect any of
          this at any time.
        </p>

        {error && (
          <p role="alert" style={{ marginBottom: 16, fontSize: 13, color: 'var(--color-danger)' }}>
            {error}
          </p>
        )}

        <div style={{ display: 'grid', gap: 12 }}>
          {providers.map((provider) => {
            const isConnected = connected.includes(provider.id)
            const available = provider.status === 'available'

            return (
              <div key={provider.id} className="glass" style={{ padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'start', gap: 13 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: `color-mix(in srgb, ${provider.accent} 22%, transparent)`,
                      border: `1px solid ${provider.accent}`,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: '0 0 2px', fontSize: 14.5, fontWeight: 620 }}>
                      {provider.name}
                    </p>
                    <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text-dim)' }}>
                      {provider.description}
                    </p>
                  </div>

                  {isConnected ? (
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-ok)' }}>
                      Connected
                    </span>
                  ) : (
                    <button
                      className="btn btn--primary"
                      style={{ padding: '8px 15px', fontSize: 12.5 }}
                      onClick={() => void connect(provider.id)}
                      disabled={!available || busy !== null}
                    >
                      {busy === provider.id ? 'Opening…' : available ? 'Connect' : 'Soon'}
                    </button>
                  )}
                </div>

                {provider.statusNote && (
                  <p style={{ margin: '11px 0 0', fontSize: 11.5, color: 'var(--color-warn)' }}>
                    {provider.statusNote}
                  </p>
                )}

                {!isConnected && available && (
                  <ul
                    style={{
                      margin: '13px 0 0', padding: 0, listStyle: 'none',
                      display: 'grid', gap: 5,
                    }}
                  >
                    {provider.permissions.map((permission) => (
                      <li
                        key={permission}
                        style={{ fontSize: 11.5, color: 'var(--color-text-dim)' }}
                      >
                        · {permission}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>

        <button
          className="btn btn--primary"
          style={{ width: '100%', marginTop: 24 }}
          onClick={() => router.push('/world')}
          disabled={connected.length === 0}
        >
          {connected.length === 0 ? 'Connect at least one tool' : 'Enter the world'}
        </button>
      </div>
    </main>
  )
}
