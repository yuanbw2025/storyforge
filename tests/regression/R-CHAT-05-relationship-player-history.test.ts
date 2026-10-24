import {expect, it} from 'vitest'
import {chatPlayerRelationshipHistoryV1} from '../../src/lib/character-interaction/relationship-player-history'
import {rebaseInteractionStateForBranch} from '../../src/lib/character-interaction/runtime'
import {chatRelationshipHistoryFixture} from '../helpers/chat-relationship-history'

it('projects both original exchanges and current attitude without changing runtime or relying on retrieval selection', () => {
  const state = chatRelationshipHistoryFixture()
  state.chatNarrative!.excludedMessageIds = ['relationship-player-70', 'relationship-actor-71']
  const before = structuredClone(state), result = chatPlayerRelationshipHistoryV1(state)
  expect(result).toHaveLength(1)
  expect(result[0].relationship.value).toBe(2)
  expect(result[0].history.map(item => item.change.eventSequence)).toEqual([71, 81])
  for (const item of result[0].history) {
    expect(item.source).toEqual(state.messages.find(message => message.eventSequence === item.change.sourceEventSequence))
    expect(item.expression).toEqual(state.messages.find(message => message.eventSequence === item.change.eventSequence))
  }
  expect(JSON.stringify(result)).not.toContain('柜台下')
  expect(state).toEqual(before)
})

it.each(['private-player', 'private-actor', 'superseded', 'missing', 'wrong-speaker', 'unspoken', 'legacy'] as const)(
  'does not expose a cause or either original message through %s evidence', variant => {
    const state = chatRelationshipHistoryFixture(), change = state.relationshipHistory[0]
    const source = state.messages.find(m => m.eventSequence === change.sourceEventSequence)!, expression = state.messages.find(m => m.eventSequence === change.eventSequence)!
    if (variant === 'private-player') source.audienceKeys = ['player', 'artisan']
    if (variant === 'private-actor') expression.audienceKeys = ['guard']
    if (variant === 'superseded') expression.supersededBySequence = 500
    if (variant === 'missing') state.messages = state.messages.filter(m => m !== expression)
    if (variant === 'wrong-speaker') expression.speakerKey = 'artisan'
    if (variant === 'unspoken') change.reason = '未说出口的私人想法'
    if (variant === 'legacy') change.ruleKey = 'legacy.automatic.rule'
    const result = chatPlayerRelationshipHistoryV1(state)
    expect(result[0].history.map(item => item.change.eventSequence)).toEqual([81])
    expect(JSON.stringify(result)).not.toContain('靛蓝钥匙')
    expect(JSON.stringify(result)).not.toContain('未说出口')
    expect(result[0].relationship.value).toBe(2)
  },
)

it('does not show relationships between other roles or their private histories', () => {
  const state = chatRelationshipHistoryFixture()
  state.relationships.push({...state.relationships[0], toParticipantKey: 'artisan', label: '秘密宿怨'})
  state.relationshipHistory.push({...state.relationshipHistory[0], toParticipantKey: 'artisan', reason: '私人矛盾'})
  const result = chatPlayerRelationshipHistoryV1(state)
  expect(result).toHaveLength(1)
  expect(JSON.stringify(result)).not.toContain('秘密宿怨')
  expect(JSON.stringify(result)).not.toContain('私人矛盾')
})

it('retains original message identities through nested branches with negative event sequences', () => {
  const state = chatRelationshipHistoryFixture(), before = chatPlayerRelationshipHistoryV1(state)[0]
  const branch = rebaseInteractionStateForBranch(rebaseInteractionStateForBranch(state, 501), 0)
  const after = chatPlayerRelationshipHistoryV1(branch)[0]
  expect(after.history.map(item => [item.source.messageId, item.expression.messageId])).toEqual(before.history.map(item => [item.source.messageId, item.expression.messageId]))
  expect(after.history.every(item => item.change.sourceEventSequence < 0 && item.change.eventSequence < 0)).toBe(true)
  expect(after.history.map(item => item.change.reason)).toEqual(before.history.map(item => item.change.reason))
})
