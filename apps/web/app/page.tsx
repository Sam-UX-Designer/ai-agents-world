import type { Metadata } from 'next'
import { Landing } from '@/components/marketing/Landing'

/**
 * The front door.
 *
 * Someone arriving here from the main site knows the product's name and
 * nothing else, so this is the page that explains it. The sign-in form lives
 * at /signin, which is where the buttons on this page lead, and which still
 * bounces anyone already signed in straight to their world.
 */
export const metadata: Metadata = {
  title: 'AI Agents World - ask once, watch a team work',
  description:
    'Give one goal. It is split into tasks, handed to the specialist agents that fit, and comes back as one answer - on an island where you can watch the work happen.',
}

export default function HomePage() {
  return <Landing />
}
