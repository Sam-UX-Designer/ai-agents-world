import type { NextConfig } from 'next'

const API_URL = process.env.API_URL

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@agents-world/shared'],
  async rewrites() {
    // No API configured - a bare `next dev`, or a Vercel deployment with no
    // backend hosted yet. The route handlers under app/api serve the catalogue
    // so every screen renders instead of answering 404.
    if (!API_URL) return []

    // The browser only ever talks to its own origin, so the session cookie is
    // first-party and no CORS configuration is needed. It also means the API's
    // real hostname is never exposed to the client.
    //
    // `beforeFiles` so the proxy wins over the preview handlers above: when a
    // real API exists, it answers everything.
    return {
      beforeFiles: [{ source: '/api/:path*', destination: `${API_URL}/:path*` }],
      afterFiles: [],
      fallback: [],
    }
  },
}

export default config
