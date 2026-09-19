import { SignInScreen } from '@/components/auth/SignInScreen'

/**
 * The front door.
 *
 * This used to be a separate landing page with a Get started button that led
 * to the sign-in page - two screens saying the same sentence, the first of
 * which existed to be clicked past. The pitch and the form are one screen
 * now, and `/signin` renders it too so nothing that linked there breaks.
 */
export default function HomePage() {
  return <SignInScreen />
}
