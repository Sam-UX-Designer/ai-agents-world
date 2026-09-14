import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

/**
 * Encryption for integration tokens at rest.
 *
 * A stolen database dump must not become a stolen inbox. Tokens are sealed
 * with AES-256-GCM under a key that lives only in the API process env, so
 * reading the `connections` table gives an attacker ciphertext and nothing
 * else.
 *
 * GCM rather than CBC because it authenticates as well as encrypts: a
 * tampered ciphertext fails to open rather than decrypting to plausible
 * garbage we might then send to Google.
 */

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12 // 96 bits, the value GCM is specified for
const KEY_BYTES = 32

const MIN_SECRET_CHARS = 24
const HKDF_INFO = 'agents-world:token-encryption:v1'

const derived = new Map<string, Buffer>()

/**
 * Turn the configured secret into a 32-byte AES key.
 *
 * AES-256 needs exactly 32 bytes. Demanding that the operator supply exactly
 * 32 bytes of base64 meant the only way to deploy was to open a terminal and
 * run openssl - which rules out deploying from a browser, and invites the far
 * worse workaround of pasting some short memorable string instead.
 *
 * So any sufficiently long secret is accepted and run through HKDF-SHA256.
 * That is what HKDF is for: it spreads whatever entropy the input has across
 * a full-length key without inventing any. A host's own "generate a random
 * value" button now works, and so does a real `openssl rand -base64 32`,
 * which still decodes to 32 bytes and is used directly.
 *
 * What HKDF cannot do is make a weak secret strong, so anything shorter than
 * 24 characters is still refused.
 */
function keyFrom(secret: string): Buffer {
  const cached = derived.get(secret)
  if (cached) return cached

  // A proper 32-byte base64 key is used unchanged, so any key generated the
  // old way keeps decrypting what it already encrypted.
  const decoded = Buffer.from(secret, 'base64')
  const key = decoded.length === KEY_BYTES ? decoded : deriveKey(secret)

  derived.set(secret, key)
  return key
}

function deriveKey(secret: string): Buffer {
  if (secret.length < MIN_SECRET_CHARS) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be at least ${MIN_SECRET_CHARS} characters, ` +
        'or 32 bytes of base64. It encrypts your integration tokens, so a ' +
        'short one is not safe.',
    )
  }

  // No salt: the key has to be reproducible from the environment alone, across
  // restarts and across instances. The secret itself carries the entropy.
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), HKDF_INFO, KEY_BYTES),
  )
}

/**
 * Seal a token.
 *
 * A fresh IV per call is not optional: reusing an IV under the same key
 * breaks GCM completely, leaking plaintext relationships between tokens.
 * Output is `v1.<iv>.<authTag>.<ciphertext>`, all base64url. The version
 * prefix is what makes a future key or algorithm rotation a migration rather
 * than a guessing game.
 */
export function encryptToken(plaintext: string, base64Key: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, keyFrom(base64Key), iv)

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])

  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

/** Open a sealed token. Throws if it was tampered with or the key is wrong. */
export function decryptToken(sealed: string, base64Key: string): string {
  const parts = sealed.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Malformed encrypted token')
  }

  const [, ivPart, tagPart, dataPart] = parts as [string, string, string, string]
  const decipher = createDecipheriv(
    ALGORITHM,
    keyFrom(base64Key),
    Buffer.from(ivPart, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

/**
 * Constant-time string comparison for secrets.
 *
 * `===` on a session token leaks how many leading characters matched through
 * timing. Rare to exploit, free to avoid.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
