/**
 * The connector catalogue.
 *
 * One entry per service a user can connect. The Connect Tools screen renders
 * this list directly, and the backend reads the same entries to drive OAuth -
 * so a provider cannot appear in the UI without a real flow behind it, or
 * work in the backend without showing up as a card.
 *
 * `status` is deliberately part of the model rather than a code comment.
 * Shipping a Connect button that cannot complete is worse than not showing
 * the card at all, so a provider that is not ready says so on its own card.
 */

export const CONNECTION_PROVIDERS = [
  'google',
  'slack',
  'microsoft',
  'notion',
] as const

export type ConnectionProvider = (typeof CONNECTION_PROVIDERS)[number]

export type ProviderStatus =
  /** OAuth implemented and usable now. */
  | 'available'
  /** Card shown, marked coming soon. Connect is disabled. */
  | 'planned'
  /** Blocked on something outside our control. The card explains what. */
  | 'blocked'

export interface ProviderDefinition {
  readonly id: ConnectionProvider
  readonly name: string
  /** Shown under the name on the connect card. */
  readonly description: string
  /** Which agents light up once this is connected. */
  readonly unlocksAgents: readonly string[]
  /** Plain-language permissions, for the consent screen. Never raw scopes -
   *  "Read your email" is a decision a user can make; a Google scope URL is not. */
  readonly permissions: readonly string[]
  readonly status: ProviderStatus
  /** Why, when status is not 'available'. Shown on the card. */
  readonly statusNote: string | null
  readonly accent: string
}

export const PROVIDERS: readonly ProviderDefinition[] = [
  {
    id: 'google',
    name: 'Google',
    description: 'Gmail and Google Calendar',
    unlocksAgents: ['email', 'calendar'],
    permissions: [
      'Read your email',
      'Save drafts',
      'Send email (only when you approve it)',
      'Read your calendar',
      'Create or change events (only when you approve it)',
    ],
    status: 'available',
    statusNote: null,
    accent: '#EA4335',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Channels, threads and messages',
    unlocksAgents: ['slack'],
    permissions: [
      'Read channels you are in',
      'Read message history',
      'Post messages (only when you approve it)',
    ],
    status: 'available',
    statusNote: null,
    accent: '#611F69',
  },
  {
    id: 'microsoft',
    name: 'Microsoft Teams',
    description: 'Teams chat, Outlook mail and calendar',
    unlocksAgents: ['email', 'calendar', 'teams'],
    permissions: [
      'Read your Teams messages',
      'Read Outlook mail and calendar',
      'Send messages (only when you approve it)',
    ],
    status: 'planned',
    statusNote: 'Coming after Google and Slack are stable.',
    accent: '#5059C9',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Pages and databases',
    unlocksAgents: ['documents'],
    permissions: ['Read pages you share with the integration', 'Create and edit pages'],
    status: 'planned',
    statusNote: 'Arrives with the Documents Agent.',
    accent: '#000000',
  },
]

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]))

export const getProvider = (id: string): ProviderDefinition | undefined => BY_ID.get(id as ConnectionProvider)

export const availableProviders = (): readonly ProviderDefinition[] =>
  PROVIDERS.filter((p) => p.status === 'available')

/**
 * Web search is not a connector.
 *
 * It needs no account, no OAuth and no consent screen, because it touches
 * none of the user's data - so putting a "Connect the web" card on the
 * connect screen would be asking permission for nothing. The Research Agent
 * gets it as a built-in capability instead.
 */
export const WEB_SEARCH_IS_BUILT_IN = true
