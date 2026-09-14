import {
  createCipheriv,
  createDecipheriv,
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

function keyFrom(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. ` +
        'Generate one with: openssl rand -base64 32',
    )
  }
  return key
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
