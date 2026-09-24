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
  title: 'AI Agents World - a workforce you can give one sentence to',
  description:
    'Most AI tools answer a question and hand the work back. This one takes the work: describe an outcome, and a team of specialist agents does it while you watch.',
}

export default function Page() {
  return <ProductPage />
}
