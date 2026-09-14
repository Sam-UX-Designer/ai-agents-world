import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  decide,
  executionWaves,
  validatePlan,
  type PlannedTask,
} from '@agents-world/shared'
import { forSpeech } from '../voice/elevenlabs.js'

const base = { grantedActionTypes: [] as string[], actionType: 'gmail.send' }

test('reading and analysing never ask', () => {
  for (const effect of ['read', 'analyse', 'draft'] as const) {
    assert.equal(
      decide({ ...base, effect, autonomy: 'ask_always' }).allow,
      true,
      `${effect} should run autonomously even at the strictest setting`,
    )
  }
})

test('sending asks by default', () => {
  const verdict = decide({ ...base, effect: 'external_send', autonomy: 'ask_always' })
  assert.equal(verdict.allow, false)
})

test('"don\'t ask again" only waives the action type it was granted for', () => {
  const granted = { ...base, grantedActionTypes: ['gmail.send'], autonomy: 'ask_once_per_type' as const }

  assert.equal(decide({ ...granted, effect: 'external_send' }).allow, true)
  assert.equal(
    decide({ ...granted, effect: 'external_send', actionType: 'slack.post_message' }).allow,
    false,
    'granting gmail.send must not also grant slack.post_message',
  )
})

test('money and deletion always ask, even in fully autonomous mode', () => {
  for (const effect of ['financial', 'destructive'] as const) {
    const verdict = decide({
      ...base,
      effect,
      autonomy: 'autonomous',
      grantedActionTypes: ['gcal.delete_event', 'payment.send'],
      actionType: 'gcal.delete_event',
    })
    assert.equal(verdict.allow, false, `${effect} must not be waivable`)
  }
})

test('a dependency cycle is caught before anything runs', () => {
  const tasks: PlannedTask[] = [
    { id: 'a', title: 'A', description: '', agentKey: 'email', dependsOn: ['b'] },
    { id: 'b', title: 'B', description: '', agentKey: 'email', dependsOn: ['a'] },
  ]
  const errors = validatePlan({ interpretation: '', tasks, unsupported: [] }, ['email'])
  assert.ok(errors.some((e) => e.kind === 'dependency_cycle'))
})

test('an invented agent is caught before anything runs', () => {
  const tasks: PlannedTask[] = [
    { id: 'a', title: 'A', description: '', agentKey: 'telepathy', dependsOn: [] },
  ]
  const errors = validatePlan({ interpretation: '', tasks, unsupported: [] }, ['email'])
  assert.ok(errors.some((e) => e.kind === 'unknown_agent'))
})

test('independent tasks land in one wave so they run in parallel', () => {
  const tasks: PlannedTask[] = [
    { id: 'mail', title: '', description: '', agentKey: 'email', dependsOn: [] },
    { id: 'cal', title: '', description: '', agentKey: 'calendar', dependsOn: [] },
    { id: 'chat', title: '', description: '', agentKey: 'slack', dependsOn: [] },
    { id: 'sum', title: '', description: '', agentKey: 'email', dependsOn: ['mail', 'cal', 'chat'] },
  ]
  const waves = executionWaves(tasks)

  assert.equal(waves.length, 2, 'three independent tasks plus one dependent = two waves')
  assert.equal(waves[0]?.length, 3, 'all three independent tasks run together')
  assert.equal(waves[1]?.[0]?.id, 'sum')
})

test('spoken text drops the marks that only exist to be looked at', () => {
  const spoken = forSpeech('**Urgent:** see [the thread](https://slack.com/x)\n- one\n- two')
  assert.ok(!spoken.includes('**'), 'no bold markers')
  assert.ok(!spoken.includes('https://'), 'no raw URL read aloud')
  assert.ok(spoken.includes('the thread'), 'the link text survives')
  assert.ok(spoken.includes('one'), 'list content survives')
})
