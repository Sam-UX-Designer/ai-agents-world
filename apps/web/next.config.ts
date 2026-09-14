import type { NextConfig } from 'next'

const API_URL = process.env.API_URL ?? 'http://localhost:4000'

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@agents-world/shared'],
  async rewrites() {
    // The browser only ever talks to its own origin, so the session cookie is
    // first-party and no CORS configuration is needed. It also means the API's
    // real hostname is never exposed to the client.
    return [{ source: '/api/:path*', destination: `${API_URL}/:path*` }]
  },
}

export default config
