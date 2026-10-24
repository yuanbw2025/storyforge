import {expect, it} from 'vitest'
import {chatNextActionLimitV1} from '../../src/lib/character-interaction/narrative-pacing'
import {DEFAULT_CHAT_NARRATIVE_SETUP_V1, parseChatNarrativeSetupV1} from '../../src/lib/character-interaction/narrative-setup'
import type {ChatNarrativeTriggerStateV1} from '../../src/lib/types/chat-narrative'

const permissions = DEFAULT_CHAT_NARRATIVE_SETUP_V1.permissions
const trigger = (limit?: number): ChatNarrativeTriggerStateV1 => ({
  kind: 'continue', requestedSequence: 3, sourceEventSequence: 2, seed: null, status: 'complete', actionSequences: [4],
  ...(limit === undefined ? {} : {direction: {actorKey: 'guard', actionLimit: limit}}),
})

it('lets new stories continue within two actions while companionship and one-step releases remain single-step', () => {
  expect(permissions.maxActionsPerTrigger).toBe(2)
  expect(chatNextActionLimitV1(permissions)).toBe(2)
  expect(chatNextActionLimitV1({...permissions, maxActionsPerTrigger: 3})).toBe(2)
  expect(chatNextActionLimitV1({...permissions, mode: 'companionship'})).toBe(1)
  expect(chatNextActionLimitV1({...permissions, maxActionsPerTrigger: 1})).toBe(1)
  expect(chatNextActionLimitV1(undefined)).toBe(1)
})

it.each([1, 2, 3])('recovers the latest explicit %s-step pace rather than resetting it after refresh or branch', limit => {
  const turns = [trigger(2), trigger(limit)], before = structuredClone(turns)
  expect(chatNextActionLimitV1({...permissions, maxActionsPerTrigger: 3}, turns)).toBe(limit)
  expect(chatNextActionLimitV1({...permissions, maxActionsPerTrigger: 1}, turns)).toBe(1)
  expect(turns).toEqual(before)
})

it('preserves saved author settings and the old UI default for historical undirected turns', () => {
  const old = {...structuredClone(DEFAULT_CHAT_NARRATIVE_SETUP_V1), permissions: {...permissions, maxActionsPerTrigger: 1}}
  expect(parseChatNarrativeSetupV1(old)).toEqual(old)
  expect(chatNextActionLimitV1(permissions, [trigger(2), trigger()])).toBe(1)
})
