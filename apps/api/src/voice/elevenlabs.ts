import { config } from '../config.js'

/**
 * Speech for agent replies.
 *
 * Agents answer in text always and in voice when the user wants it. Text is
 * the source of truth: the same string is rendered on screen and spoken, so a
 * user reading and a user listening receive exactly the same answer.
 *
 * Voice is optional by design. If no API key is configured, or ElevenLabs is
 * unreachable, `speak` returns null and the product carries on in text. A
 * failed text-to-speech call must never fail an agent run that has already
 * done the user's actual work.
 */

const API_BASE = 'https://api.elevenlabs.io/v1'

/** The product voice, from the voice library link the owner supplied. */
export const DEFAULT_VOICE_ID = 'jpICOesdLlRSc39O1UB5'

/**
 * Turbo, for latency.
 *
 * An agent reply that takes three seconds to start speaking feels broken, so
 * this trades a little fidelity for time-to-first-audio. Override per call if
 * a longer, more considered read is wanted.
 */
const DEFAULT_MODEL_ID = 'eleven_turbo_v2_5'

export interface SpeakOptions {
  readonly voiceId?: string
  readonly modelId?: string
  /** 0-1. Higher is steadier, lower is more expressive. */
  readonly stability?: number
  readonly similarityBoost?: number
}

export interface SpeechResult {
  readonly audio: Buffer
  readonly contentType: string
  readonly voiceId: string
}

export function voiceEnabled(): boolean {
  return Boolean(config().ELEVENLABS_API_KEY)
}

/**
 * Render text to speech.
 *
 * Returns null rather than throwing when voice is unavailable. Callers treat
 * a null as "no audio this time" and still deliver the text, which is what
 * keeps a missing key or a provider outage from becoming a broken product.
 */
export async function speak(
  text: string,
  options: SpeakOptions = {},
): Promise<SpeechResult | null> {
  const apiKey = config().ELEVENLABS_API_KEY
  if (!apiKey) return null

  const voiceId = options.voiceId ?? DEFAULT_VOICE_ID

  try {
    const res = await fetch(`${API_BASE}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: forSpeech(text),
        model_id: options.modelId ?? DEFAULT_MODEL_ID,
        voice_settings: {
          stability: options.stability ?? 0.5,
          similarity_boost: options.similarityBoost ?? 0.75,
        },
      }),
    })

    if (!res.ok) {
      console.error(`[voice] ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`)
      return null
    }

    return {
      audio: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') ?? 'audio/mpeg',
      voiceId,
    }
  } catch (err) {
    console.error('[voice] text-to-speech failed, continuing in text only', err)
    return null
  }
}

/**
 * Stream speech, for replies long enough that waiting for the whole file
 * would feel like a hang.
 */
export async function speakStream(
  text: string,
  options: SpeakOptions = {},
): Promise<ReadableStream<Uint8Array> | null> {
  const apiKey = config().ELEVENLABS_API_KEY
  if (!apiKey) return null

  const voiceId = options.voiceId ?? DEFAULT_VOICE_ID

  try {
    const res = await fetch(`${API_BASE}/text-to-speech/${voiceId}/stream`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: forSpeech(text),
        model_id: options.modelId ?? DEFAULT_MODEL_ID,
        voice_settings: {
          stability: options.stability ?? 0.5,
          similarity_boost: options.similarityBoost ?? 0.75,
        },
      }),
    })

    if (!res.ok || !res.body) {
      console.error(`[voice] ElevenLabs stream ${res.status}`)
      return null
    }
    return res.body
  } catch (err) {
    console.error('[voice] speech stream failed, continuing in text only', err)
    return null
  }
}

/**
 * Rewrite display text into something worth listening to.
 *
 * Agent answers are written for the screen: markdown emphasis, bullet markers,
 * links. Read aloud verbatim, a URL becomes thirty seconds of punctuation. The
 * spoken and displayed text stay the same words - this only strips the marks
 * that exist purely to be looked at.
 */
export function forSpeech(text: string): string {
  return text
    // Keep the link's words, drop the URL.
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    // A bullet becomes a pause, which is how a person would read a list.
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
