import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/client.js'
import { createWorkspace } from './workspaces.js'

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

/**
 * Registration and sign-in with an email address and a password.
 *
 * Exists alongside Google and Apple rather than replacing them: a social
 * button is one tap, but it also requires the person to have that account and
 * to be willing to link it, which rules out testing and rules out anyone who
 * simply would rather not.
 *
 * scrypt rather than a bcrypt or argon2 dependency, because it ships with
 * Node and is a genuine memory-hard KDF. The cost parameters below are the
 * point of the whole exercise: a password store is only as good as how slow
 * it is to guess against.
 */

const SALT_BYTES = 16
const KEY_BYTES = 64

export const MIN_PASSWORD_LENGTH = 8

/** `scrypt$<salt base64>$<hash base64>`, so the format can be changed later. */
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const key = await scrypt(password, salt, KEY_BYTES)
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltPart, keyPart] = stored.split('$')
  if (scheme !== 'scrypt' || !saltPart || !keyPart) return false

  const expected = Buffer.from(keyPart, 'base64')
  const actual = await scrypt(password, Buffer.from(saltPart, 'base64'), expected.length)
  // Constant time: a plain === leaks how many bytes matched through timing.
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export interface Registration {
  readonly name: string
  readonly email: string
  readonly password: string
  readonly phone?: string | null
}

export class AuthError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'AuthError'
  }
}

export async function register(
  input: Registration,
): Promise<{ userId: string; workspaceId: string }> {
  const email = input.email.trim().toLowerCase()

  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }

  const [existing] = await db()
    .select({ id: schema.users.id, passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1)

  if (existing) {
    // Deliberately the same message whether or not they have a password set:
    // a different one would confirm which addresses have accounts here.
    throw new AuthError('An account with that email already exists. Try signing in.', 409)
  }

  const [created] = await db()
    .insert(schema.users)
    .values({
      email,
      name: input.name.trim() || null,
      phone: input.phone?.trim() || null,
      passwordHash: await hashPassword(input.password),
    })
    .returning({ id: schema.users.id })

  if (!created) throw new AuthError('Could not create the account.', 500)

  // Recorded like any other identity, so a later "sign in with Google" on the
  // same address links to this account instead of making a second one.
  await db()
    .insert(schema.identities)
    .values({ userId: created.id, provider: 'email', subject: email })
    .onConflictDoNothing()

  const firstName = input.name.trim().split(' ')[0]
  const workspace = await createWorkspace(
    created.id,
    firstName ? `${firstName}'s workspace` : 'My workspace',
  )

  return { userId: created.id, workspaceId: workspace.workspaceId }
}

export async function login(
  emailInput: string,
  password: string,
): Promise<{ userId: string; workspaceId: string }> {
  const email = emailInput.trim().toLowerCase()

  const [user] = await db()
    .select({ id: schema.users.id, passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1)

  // One message for "no such account", "that account uses Google" and "wrong
  // password". Telling them apart is a free account-enumeration oracle.
  const wrong = new AuthError('That email and password do not match.', 401)

  if (!user?.passwordHash) {
    // Still spend the time hashing. Returning instantly for an unknown address
    // makes the response time itself the oracle we just avoided.
    await scrypt(password, randomBytes(SALT_BYTES), KEY_BYTES)
    throw wrong
  }

  if (!(await verifyPassword(password, user.passwordHash))) throw wrong

  const [membership] = await db()
    .select({ workspaceId: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, user.id))
    .limit(1)

  if (membership) return { userId: user.id, workspaceId: membership.workspaceId }

  // No workspace: an earlier registration failed partway. Give them one rather
  // than leaving a signed-in user with nowhere to land.
  const workspace = await createWorkspace(user.id, 'My workspace')
  return { userId: user.id, workspaceId: workspace.workspaceId }
}
