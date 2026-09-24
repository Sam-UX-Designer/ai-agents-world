import type { Metadata } from 'next'
import { ProductPage } from '@/components/product/ProductPage'
import './product.css'

/**
 * The page a link from elsewhere lands on.
 *
 * Deliberately not the app's front door: `/` is the sign-in screen and stays
 * that way. This is a separate address so it can be linked from anywhere
 * without changing how anyone reaches the product itself.
 */
export const metadata: Metadata = {
  title: 'AI Agents World - ask once, watch the AI agents working',
  description:
    'You give one goal. It is split into tasks, handed to the specialist agents that fit, and comes back as one answer - on an island where you can watch the work happen.',
}

export default function Page() {
  return <ProductPage />
}
