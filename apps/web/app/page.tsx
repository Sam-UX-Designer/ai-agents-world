import { redirect } from 'next/navigation'

/**
 * The front door.
 *
 * It used to be the sign-in form. Someone handed a link to this product met a
 * password box before they had seen a single thing it does, which is a lot to
 * ask of a stranger - so the door now opens onto the product itself and the
 * form waits at /signin until there is a reason to show it.
 *
 * A redirect rather than a second copy of the world: one implementation of
 * Home, reached two ways, so they cannot drift apart.
 */
export default function Page() {
  redirect('/world')
}
