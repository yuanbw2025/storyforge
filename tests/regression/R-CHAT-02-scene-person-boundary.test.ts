import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {chatTurnAudienceGuidanceV1, chatTurnAudienceGuidanceV2, assertChatTurnAudienceV1} from '../../src/lib/character-interaction/narrative-audience'
import {buildInteractionContextWindow, interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import {formatInteractionRuntimeContextV1} from '../../src/lib/character-interaction/context-format'
import {chatActionContextVersionsV1} from '../../src/lib/character-interaction/context-selection'
import {buildChatActionChoiceMessagesV1, chatActionChoiceRequestOptionsV1} from '../../src/lib/character-interaction/action-choice-contract'
import {generateInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1, adoptInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readChatCandidateRetrievalVersion} from '../../src/lib/character-interaction/context-reader-version'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {inquiryQuestion} from '../helpers/chat-inquiry-output'
import type {ChatMessage} from '../../src/lib/types'

const originalSkill = skills.getAgentSkillV1
const old = 'chat-narrative-action-v48', current = 'chat-narrative-action-v50'
const legacyInstruction = '本轮表达与新事实的听众仅限玩家及这里列出的角色；调度、新目标、打算和剧情线不得扩至其他角色。私聊须保留共用场景标题、时地，不得转场。已有共同事项不能在未通知其他参与者时私下修改。'
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
function freeze(version: string) {
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => {
    const skill = originalSkill(id)
    return id === 'character.chat-narrative-action' ? {...skill, promptVersion: version}
      : id === 'character.chat-narrative-action-review' ? {...skill, promptVersion: 'chat-narrative-action-review-v34'} : skill
  })
}
async function start(mode: 'present' | 'private' = 'present') {
  const f = await seedChatNarrativeRuntimeFixture({inquiryResults: true, factDiscovery: true})
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'scene-person.start', baseSequence: v.sequence,
    baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence,
    direction: {actorKey: 'guard', actionLimit: 1, audienceParticipantKeys: mode === 'present' ? ['guard', 'artisan'] : ['guard'], conversationMode: mode}})
  return f
}

it('keeps historical and private audience contracts and rejects extra registered listeners', () => {
  const publicTurn = {audienceParticipantKeys: ['guard'], conversationMode: 'present' as const}
  expect(chatTurnAudienceGuidanceV1(publicTurn)).toEqual({conversationBoundary: {participantKeys: ['guard'], mode: 'present', instruction: legacyInstruction}})
  for (const direction of [undefined, {audienceParticipantKeys: ['guard']}, {...publicTurn, conversationMode: 'private' as const}]) {
    expect(chatTurnAudienceGuidanceV2(direction)).toEqual(chatTurnAudienceGuidanceV1(direction))
  }
  expect(chatActionContextVersionsV1(old).readerVersion).toBe('chat-narrative-runtime-view-v15')
  expect(chatActionContextVersionsV1(current).readerVersion).toBe('chat-narrative-runtime-view-v16')
  expect(() => assertChatTurnAudienceV1(publicTurn, 'player', ['guard', 'invented-scene-person'])).toThrow('听众范围')
  expect(() => assertChatTurnAudienceV1({...publicTurn, conversationMode: 'private'}, 'player', ['guard', 'artisan'])).toThrow('听众范围')
})

it.each(['present', 'private'] as const)('changes only the public model explanation, preserving facts, privacy and budgets: %s', async mode => {
  const f = await start(mode), state = (await readProductRuntimeState(f.sessionId)).interaction!, before = structuredClone(state)
  const historical = buildInteractionContextWindow(state, 'guard', {retrievalVersion: 'chat-relevance-v11'})
  const now = buildInteractionContextWindow(state, 'guard', {retrievalVersion: 'chat-relevance-v12'})
  const rendered = formatInteractionRuntimeContextV1(state.profiles[0], now)
  expect(now.chatNarrative!.facts).toEqual(historical.chatNarrative!.facts)
  expect(now.chatNarrative!.permissions).toEqual(historical.chatNarrative!.permissions)
  expect(now.messages).toEqual(historical.messages)
  expect(now.chatNarrative!.conversationBoundary!.participantKeys).toEqual(mode === 'present' ? ['guard', 'artisan'] : ['guard'])
  if (mode === 'present') {
    expect(rendered).toContain('不需要加入主角色名单才能交谈')
    expect(rendered).toContain('不能预写答复、发现或玩家行动')
    expect(rendered).toContain('不得把私有信息说给无权得知的场景人物')
    expect(historical.chatNarrative!.conversationBoundary!.instruction).toBe(legacyInstruction)
  } else expect(now).toEqual(historical)
  expect(now.chatNarrative!.facts.some(f => f.factKey === 'clerk-present')).toBe(true)
  expect(rendered).not.toContain('铜印用于拓印破损的通行单')
  expect(rendered).not.toContain('他是保管者')
  expect(interactionVisibilityView(state, 'guard').chatNarrative!.conversationBoundary!.instruction).toBe(legacyInstruction)
  expect(state).toEqual(before)
  const messages: ChatMessage[] = [{role: 'system', content: 'existing expression rules'}, {role: 'user', content: rendered}]
  const selected = buildChatActionChoiceMessagesV1(messages, current)
  expect(selected[1]).toEqual(messages[1])
  expect(selected[0]).toEqual(buildChatActionChoiceMessagesV1(messages, old)[0])
  expect(chatActionChoiceRequestOptionsV1('codex', current)).toEqual(chatActionChoiceRequestOptionsV1('codex', old))
})

it.each([old, current])('retains the frozen reader through review recovery and actual inquiry adoption: %s', async producer => {
  freeze(producer)
  const f = await start(), before = await readProductRuntimeState(f.sessionId), calls: ChatMessage[][] = []
  let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId,
    participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '工程实际提问与旧读取恢复',
    runAI: withChatActionChoiceFixture(async messages => {
      calls.push(messages)
      expect(messages[1].content.includes('不需要加入主角色名单才能交谈')).toBe(producer === current)
      return JSON.stringify({kind: 'speak', text: inquiryQuestion, goalKey: 'find-seal',
        evidenceFactKeys: ['lost', 'clerk-present', 'box'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
        newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
        situationRequest: {threadKey: 'investigate', direction: '承接已实际提出的问题，不预写答复。',
          evidenceFactKeys: ['lost', 'clerk-present', 'box'], evidenceExcerpt: inquiryQuestion}})
    }),
    onNarrativeActionSaved: id => {runId = id; throw Error('saved-before-review')},
  })).rejects.toThrow('saved-before-review')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  vi.restoreAllMocks(); freeze(producer === current ? old : current)
  db.close(); await db.open()
  let reviewed = 0
  await expect(resumeChatNarrativeReviewV1({scope: f.scope, runId,
    runReviewAI: async () => {reviewed++; return JSON.stringify(chatActionReviewOutputFixture())}})).rejects.toThrow('生成配置或功能版本已变化')
  expect(reviewed).toBe(0)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  vi.restoreAllMocks(); freeze(producer)
  const reviewedRun = await resumeChatNarrativeReviewV1({scope: f.scope, runId,
    runReviewAI: async () => {reviewed++; return JSON.stringify(chatActionReviewOutputFixture())}})
  expect(await readChatCandidateRetrievalVersion(reviewedRun.snapshot, f.scope.projectId, 'interactionRuntime', 'guard', before.interaction!))
    .toBe(producer === current ? 'chat-relevance-v12' : 'chat-relevance-v11')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  const after = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(after.messages.at(-1)!.text).toBe(inquiryQuestion)
  expect(after.chatNarrative!.pendingSituation!.sourceEventSequence).toBe(after.messages.at(-1)!.eventSequence)
  expect(after.profiles).toEqual(before.interaction!.profiles)
  expect(after.chatNarrative!.situation.facts).toEqual(before.interaction!.chatNarrative!.situation.facts)
  expect(after.chatNarrative!.inquiryHistory ?? []).toEqual([])
  expect(calls).toHaveLength(1); expect(reviewed).toBe(1)
})
