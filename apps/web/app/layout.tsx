import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI Agents World',
  description:
    'Give one goal. Watch a team of AI agents work together in a living 3D world.',
}

export const viewport: Viewport = {
  themeColor: '#0A1628',
  // The world is a pan-and-zoom surface; a browser zoom on top of it fights
  // the camera controls.
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
