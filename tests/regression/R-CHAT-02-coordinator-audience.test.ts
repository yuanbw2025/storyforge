import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {createHash} from 'node:crypto'
import real from '../fixtures/character-chat-coordinator-audience-v319.json'
import legacy from '../fixtures/character-chat-coordinator-audience-legacy.json'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {chatCoordinatorAudienceVersionV1} from '../../src/lib/character-interaction/coordinator-audience'
import {buildChatHistoryCoordinatorProjectionV1} from '../../src/lib/character-interaction/history-coordinator-context'
import {bindChatOwnEvidenceV1} from '../../src/lib/character-interaction/action-evidence-binding'
import {compileChatActionWireV1} from '../../src/lib/character-interaction/action-wire'
import {parseChatNarrativeActionV1, previewChatNarrativeActionV1} from '../../src/lib/character-interaction/narrative-actions'
import {generateInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1, resumeChatSituationReviewV1, adoptInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {inquiryQuestion} from '../helpers/chat-inquiry-output'
import {prepareChatInquiryFixture, chatInquiryDraftFixture, chatInquiryInputFixture, chatInquiryReviewFixture} from '../helpers/chat-inquiry-result'
import {chatActionRequestOptionsV1} from '../../src/lib/character-interaction/action-output-contract'
import {chatActionReviewPromptRulesV1} from '../../src/lib/character-interaction/narrative-action-prompt'
import {chatInquiryGenerationRulesV1, chatInquiryReviewRulesV1} from '../../src/lib/character-interaction/inquiry-prompt'
import type {CharacterInteractionRuntimeState} from '../../src/lib/types'

const originalSkill = skills.getAgentSkillV1
const legacyInstruction = '本轮表达与新事实的听众仅限玩家及这里列出的角色'
const modernInstruction = '不需要加入主角色名单才能交谈'
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
it('preserves the exact pre-edit coordinator, output schema and historical prompt bytes', () => {
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex')
  expect(hash(buildChatHistoryCoordinatorProjectionV1(real.state as unknown as CharacterInteractionRuntimeState, {text: '', retrievalVersion: 'chat-relevance-v13'}))).toBe(legacy.coordinator)
  expect(hash(chatActionReviewPromptRulesV1({actions: [], options: false, compact: false, reviewerVersion: 'chat-narrative-action-review-v37'}))).toBe(legacy.actionReview)
  expect(hash(chatActionReviewPromptRulesV1({actions: [], options: true, compact: false, reviewerVersion: 'chat-narrative-options-review-v27'}))).toBe(legacy.optionsReview)
  expect(hash(chatActionRequestOptionsV1('chat-narrative-action-v60', 'codex'))).toBe(legacy.actionSchema)
  expect(hash(chatInquiryGenerationRulesV1('chat-situation-construction-v16'))).toBe(legacy.inquiryGeneration)
  expect(hash(chatInquiryReviewRulesV1('chat-situation-review-v15'))).toBe(legacy.inquiryReview)
})
function freeze(legacy: boolean) {
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => {
    const skill = originalSkill(id)
    return id === 'character.chat-narrative-action' ? {...skill, promptVersion: legacy ? 'chat-narrative-action-v60' : 'chat-narrative-action-v61'}
      : id === 'character.chat-narrative-action-review' ? {...skill, promptVersion: legacy ? 'chat-narrative-action-review-v37' : 'chat-narrative-action-review-v38'} : skill
  })
}

it('reproduces the actual V319 actor/reviewer mismatch without adopting or altering its expression', () => {
  expect(createHash('sha256').update(real.rawText).digest('hex')).toBe(real.rawSha256)
  expect(JSON.parse(real.rawText)).toEqual(real.response)
  expect(real.actorMessages[1].content).toContain(modernInstruction)
  expect(real.reviewMessages[1].content).toContain(legacyInstruction)
  const state = structuredClone(real.state) as unknown as CharacterInteractionRuntimeState
  const actor = state.profiles[0].participantKey
  const action = parseChatNarrativeActionV1(bindChatOwnEvidenceV1(compileChatActionWireV1(real.response.action, 'chat-narrative-action-v61', [state.playerKey, actor]), 'chat-narrative-action-v61'))
  const candidate = {text: JSON.stringify({actorKey: actor, action}), actorKey: actor, retrievalVersion: 'chat-relevance-v13' as const}
  const old = buildChatHistoryCoordinatorProjectionV1(state, candidate)
  const latest = buildChatHistoryCoordinatorProjectionV1(state, {...candidate, audienceVersion: 2})
  expect(old.text).toContain(legacyInstruction)
  expect(latest.text).toContain(modernInstruction)
  expect(latest.text).not.toContain(legacyInstruction)
  expect(latest.text).toContain('主角色及玩家的知情变化')
  expect(latest.text).toContain('不自动证明对方听懂、相信、接受')
  expect(latest.text).toContain('原私有背景、未获知秘密')
  expect(latest.text).toContain('local-1-3')
  expect(() => previewChatNarrativeActionV1(state, {sequence: 2, triggerSequence: 1, actorKey: actor, messageId: 'retained-v319', action})).not.toThrow()
  expect(state).toEqual(real.state)
  // Calling the current projection cannot poison the cached historical view.
  expect(buildChatHistoryCoordinatorProjectionV1(state, candidate)).toEqual(old)
  const unknownState = structuredClone(state)
  const unknown = unknownState.chatNarrative!.situation.facts[0]
  unknown.audienceKeys = [state.playerKey]
  expect(() => previewChatNarrativeActionV1(unknownState, {sequence: 2, triggerSequence: 1, actorKey: actor, messageId: 'unknown-fact', action: {...action, evidenceFactKeys: [...action.evidenceFactKeys, unknown.factKey]}})).toThrow()
  expect(() => previewChatNarrativeActionV1(state, {sequence: 2, triggerSequence: 1, actorKey: actor, messageId: 'fake-person', action: {...action, audienceKeys: [...action.audienceKeys, 'innkeeper']}})).toThrow()
})

it.each(['private', 'legacy-narrowed'] as const)('preserves the original coordinator bytes and knowledge for %s turns', mode => {
  const state = structuredClone(real.state) as unknown as CharacterInteractionRuntimeState
  const direction = state.chatNarrative!.triggers.slice(-1)[0].direction!
  if (mode === 'private') direction.conversationMode = 'private'
  else delete direction.conversationMode
  const candidate = {text: '', retrievalVersion: 'chat-relevance-v13' as const}
  const old = buildChatHistoryCoordinatorProjectionV1(state, candidate)
  expect(buildChatHistoryCoordinatorProjectionV1(state, {...candidate, audienceVersion: 2})).toEqual(old)
  expect(old.text).toContain(legacyInstruction)
  expect(old.text).not.toContain('scenePersonCommunication')
})

it('selects the new coordinator policy only from the exact frozen step and skill', () => {
  for (const [stepId, skillId, promptVersion] of [
    ['interaction:runtime-candidate', 'character.chat-situation-construction', 'chat-situation-construction-v17'],
    ['interaction:action-review', 'character.chat-narrative-action-review', 'chat-narrative-action-review-v38'],
    ['interaction:action-review', 'character.chat-narrative-options-review', 'chat-narrative-options-review-v28'],
  ]) {
    const binding = {stepId, skillId, promptVersion}
    expect(chatCoordinatorAudienceVersionV1({executionBindings: [binding]})).toBe(2)
    expect(chatCoordinatorAudienceVersionV1({executionBindings: [{...binding, stepId: 'wrong'}]})).toBe(1)
    expect(chatCoordinatorAudienceVersionV1({executionBindings: [{...binding, skillId: 'other-product'}]})).toBe(1)
  }
  expect(chatCoordinatorAudienceVersionV1({})).toBe(1)
  expect(chatCoordinatorAudienceVersionV1({executionBindings: [{stepId: 'interaction:action-review', skillId: 'character.chat-narrative-action-review', promptVersion: 'chat-narrative-action-review-v37'}]})).toBe(1)
  expect(chatActionRequestOptionsV1('chat-narrative-action-v61', 'codex')).toEqual(chatActionRequestOptionsV1('chat-narrative-action-v60', 'codex'))
  expect(chatActionRequestOptionsV1('chat-narrative-options-v37', 'agnes')).toEqual(chatActionRequestOptionsV1('chat-narrative-options-v36', 'agnes'))
})

it.each(['present', 'private'] as const)('uses the same registered audience policy in inquiry generation and recovered review: %s', async conversationMode => {
  const f = await prepareChatInquiryFixture({conversationMode})
  const draft = await chatInquiryDraftFixture(f.sessionId)
  const before = await readProductRuntimeState(f.sessionId)
  let runId = 0, generated = 0, reviewed = 0
  await expect(generateInteractionRuntimeCandidateV1({...chatInquiryInputFixture(f), runAI: async messages => {
    generated++
    expect(messages[1].content.includes(modernInstruction)).toBe(conversationMode === 'present')
    expect(messages[1].content.includes('scenePersonCommunication')).toBe(conversationMode === 'present')
    return JSON.stringify(draft)
  }, onSituationDraftSaved: id => {runId = id; throw Error('saved-before-review')}})).rejects.toThrow('saved-before-review')
  db.close(); await db.open()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  await resumeChatSituationReviewV1({scope: f.scope, runId, runReviewAI: async messages => {
    reviewed++
    expect(messages[1].content.includes(modernInstruction)).toBe(conversationMode === 'present')
    return JSON.stringify(chatInquiryReviewFixture(draft))
  }})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  expect((await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.inquiryHistory).toHaveLength(1)
  expect([generated, reviewed]).toEqual([1, 1])
})

it.each(['current-public', 'current-private', 'legacy-public', 'rejected-public'] as const)('delivers the versioned registered source through durable review recovery: %s', async mode => {
  const legacy = mode === 'legacy-public', privateTurn = mode === 'current-private', rejected = mode === 'rejected-public'
  freeze(legacy)
  const f = await seedChatNarrativeRuntimeFixture({inquiryResults: true, factDiscovery: true})
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'coordinator-audience', baseSequence: v.sequence, baseStateHash: v.stateHash,
    kind: 'scene-start', sourceEventSequence: f.sceneSequence, direction: {actorKey: 'guard', actionLimit: 1,
      audienceParticipantKeys: privateTurn ? ['guard'] : ['guard', 'artisan'], conversationMode: privateTurn ? 'private' : 'present'}})
  const before = await readProductRuntimeState(f.sessionId), world = await db.worldReleases.toArray()
  let runId = 0, generated = 0, reviewed = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard',
    skillId: 'character.chat-narrative-action', objective: '场景人物上下文与独立审查恢复工程检查',
    runAI: withChatActionChoiceFixture(async () => {generated++; return JSON.stringify({kind: 'speak', text: inquiryQuestion, goalKey: 'find-seal',
      evidenceFactKeys: ['lost', 'clerk-present', 'box'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
      newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})}),
    onNarrativeActionSaved: id => {runId = id; throw Error('saved-before-review')},
  })).rejects.toThrow('saved-before-review')
  db.close(); await db.open()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  const review = async () => resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async messages => {
    reviewed++
    expect(messages[1].content.includes(modernInstruction)).toBe(!legacy && !privateTurn)
    expect(messages[1].content.includes(legacyInstruction)).toBe(legacy || privateTurn)
    expect(messages[1].content.includes('scenePersonCommunication')).toBe(!legacy && !privateTurn)
    const output = chatActionReviewOutputFixture()
    if (rejected) output.checks.find(c => c.check === 'visibility')!.passed = false
    return JSON.stringify(output)
  }})
  if (rejected) {
    await expect(review()).rejects.toThrow()
    await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  } else {
    await review(); await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
    const after = (await readProductRuntimeState(f.sessionId)).interaction!
    expect(after.messages.slice(-1)[0].text).toBe(inquiryQuestion)
    expect(after.profiles).toEqual(before.interaction!.profiles)
    expect(after.chatNarrative!.situation.facts).toEqual(before.interaction!.chatNarrative!.situation.facts)
    const importedProject = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    db.close(); await db.open()
    const imported = (await db.productRuntimeSessions.where('projectId').equals(importedProject).toArray())[0]
    expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(after)
  }
  expect((await db.worldReleases.toArray()).filter(w => w.projectId === f.scope.projectId)).toEqual(world)
  expect([generated, reviewed]).toEqual([1, 1])
})
