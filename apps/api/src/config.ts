import { z } from 'zod'

/**
 * Environment configuration, validated once at boot.
 *
 * A missing secret should stop the process on line one with a clear message,
 * not surface three hours later as an agent failing mid-run against a live
 * user's inbox.
 */

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),

  /** 32 bytes, base64. Generate with: openssl rand -base64 32 */
  TOKEN_ENCRYPTION_KEY: z.string().min(1, 'TOKEN_ENCRYPTION_KEY is required'),
  /** Signs session cookies. Rotating it logs everyone out, which is the point. */
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),

  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),

  /**
   * Apple sign-in. Four values, all from the Apple Developer portal, and all
   * required together - Apple's client secret is a JWT this server signs with
   * the .p8 key rather than a static string. APPLE_PRIVATE_KEY holds the .p8
   * contents with its newlines escaped as \n.
   */
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),

  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_REDIRECT_URI: z.string().optional(),

  /** Optional. Without it agents reply in text only and the app still works. */
  ELEVENLABS_API_KEY: z.string().optional(),
})

export type Config = z.infer<typeof schema>

let cached: Config | null = null

export function config(): Config {
  if (cached) return cached

  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }

  cached = parsed.data
  return cached
}

/** Which integrations this deployment can offer, given what is configured. */
export function configuredProviders(c: Config): readonly ('google' | 'slack')[] {
  const providers: ('google' | 'slack')[] = []
  if (c.GOOGLE_CLIENT_ID && c.GOOGLE_CLIENT_SECRET && c.GOOGLE_REDIRECT_URI) {
    providers.push('google')
  }
  if (c.SLACK_CLIENT_ID && c.SLACK_CLIENT_SECRET && c.SLACK_REDIRECT_URI) {
    providers.push('slack')
  }
  return providers
}
