import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1, cancelInteractionRuntimeRunV1} from '../../src/lib/character-interaction/harness'
import {applyChatNarrativeActionV1, applyReviewedChatNarrativeActionV1, parseChatNarrativeActionReviewV1} from '../../src/lib/character-interaction/narrative-actions'
import {commitChatNarrativeAction, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {readInstanceAgentRunV1, appendAgentRunEventV1} from '../../src/lib/agent/run/event-store'
import {hashCanonicalValue} from '../../src/lib/agent/run/hash'
import {recordAgentRunArtifactV1} from '../../src/lib/memory/artifact-store'
import {CHAT_ACTION_REVIEW_STEP_V1} from '../../src/lib/character-interaction/situation-harness'
import {recordChatActionOutputBudgetV1} from '../../src/lib/character-interaction/action-choice-output-budget'
import {assembleContext} from '../../src/lib/registry/assemble-context'
import {createContextManifestFromAssemblyV1} from '../../src/lib/agent/run/context-manifest'
import {chatActionReviewFixture, chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const action: ChatNarrativeActionV1 = {kind: 'complete', text: '叶岑把油灯移到门边。门边亮了起来。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
  newFacts: [{factKey: 'lamp', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'}], disclosures: [], threadUpdates: [], goalStatus: null}
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())
async function prepared() {
  const f = await seedChatNarrativeRuntimeFixture(), v = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'start', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  return {...f, triggerSequence: trigger.sequence}
}
function input(f: Awaited<ReturnType<typeof prepared>>) {
  return {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const,
    objective: '自主处理当前问题，不替玩家行动', runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())}
}
it('keeps role generation filtered, reviews exact stored action with coordinator evidence and adopts both text and fact once', async () => {
  const f = await prepared(), before = await readProductRuntimeStateVersion(f.sessionId)
  const generated = await generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async messages => {
    expect(JSON.stringify(messages)).not.toContain('柜台下')
    return JSON.stringify(action)
  }), runReviewAI: async messages => {
    const text = JSON.stringify(messages)
    expect(text).toContain('本次持久化行动候选'); expect(text).toContain('柜台下'); expect(text).toContain('门边亮了起来')
    return JSON.stringify(chatActionReviewOutputFixture())
  }})
  expect(generated.snapshot.contract.executionBindings?.map(b => b.stepId)).toEqual(['interaction:action-choice', 'interaction:runtime-candidate', 'interaction:action-review'])
  expect(generated.snapshot.contract.executionBindings).toMatchObject([{version: 2, maxOutputTokens: 2000}, {version: 2, maxOutputTokens: 4000}, {version: 2, maxOutputTokens: 8000}])
  expect(generated.snapshot.events.filter(e => e.type === 'model.requested')).toHaveLength(3)
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(before)
  db.close(); await db.open()
  const adopted = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  expect(adopted.event?.type).toBe('interaction.narrative.action-reviewed.committed')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.messages).toHaveLength(1); expect(state.remainingDirectorBudget).toBe(97)
  expect(state.chatNarrative!.situation.facts.filter(f => f.factKey === 'lamp')).toHaveLength(1)
})
it('keeps a reviewed first-person preference as speech without publishing its private context or promoting it to truth', async () => {
  const f = await prepared(), before = (await readProductRuntimeState(f.sessionId)).interaction!
  const expression: ChatNarrativeActionV1 = {...action, kind: 'speak', newFacts: [],
    text: '叶岑说：“我更喜欢先仔细看看，也有点担心太着急会判断错。你可以先休息。”'}
  const assertPolicy = (messages: Array<{content: string}>, review = false) => {
    expect(messages[0].content).toContain(review ? '主观发言只作为该角色说过的话保留' : '仅作为本次说过的话，无需 newFacts/disclosures')
    expect(messages[0].content).toContain(review ? '没有可用 factKey 不等于允许披露来源资料中的事实' : '没有 factKey 也不授权披露或编造键、复制秘密')
  }
  const generated = await generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async messages => {
    assertPolicy(messages); return JSON.stringify(expression)
  }), runReviewAI: async messages => {
    assertPolicy(messages, true); return JSON.stringify(chatActionReviewOutputFixture())
  }})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  db.close(); await db.open()
  const after = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(after.messages).toHaveLength(1)
  expect(after.messages[0]).toMatchObject({role: 'character', speakerKey: 'guard', text: expression.text})
  expect(after.chatNarrative!.situation).toEqual(before.chatNarrative!.situation)
  expect(after.knowledge).toEqual(before.knowledge)
  expect(after.memories).toEqual(before.memories)
  // This fixture checks application of a review result, not the model's ability
  // to distinguish genuine self-expression from a concealed factual disclosure.
})
it.each([
  ['continuity', '铜印从来没有丢过。'], ['permissions', '叶岑无缘无故把驿站烧毁了。'],
  ['player-agency', '沈禾点头答应，跟叶岑走出了门。'], ['visibility', '铜印就在柜台底下那个木匣里。'],
  ['visibility', '我更喜欢藏着铜印的那个木匣。'],
  ['visibility', '我担心你发现我曾误指控无辜旅人。'],
  ['consequences', '叶岑已经打开了大门。'], ['meaningful-direction', '你确定不去吗？还是一起去后门吧。'],
] as const)('preserves a %s rejection as evidence and never shows or commits the rejected action', async (check, text) => {
  const f = await prepared(), before = await readProductRuntimeStateVersion(f.sessionId)
  const bad = {...action, text, newFacts: []}, review = chatActionReviewOutputFixture()
  review.checks.find(c => c.check === check)!.passed = false
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  // These outputs are structurally well formed. This test verifies the review
  // rejection boundary, not a claim that a test fixture is a semantic judge.
  expect(() => applyChatNarrativeActionV1(state, {sequence: before.sequence + 1, triggerSequence: f.triggerSequence, actorKey: 'guard', messageId: 'dry', action: bad})).not.toThrow()
  let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runAI: withChatActionChoiceFixture(async () => JSON.stringify(bad)), runReviewAI: async () => JSON.stringify(review)})).rejects.toThrow('行动语义审查未通过')
  expect((await readInstanceAgentRunV1(f.scope, runId)).projection.state).toBe('failed')
  expect((await db.agentRunArtifacts.toArray()).some(a => a.artifactKind === 'raw-response' && a.content === JSON.stringify(review))).toBe(true)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(before)
})
it('binds all six checks to the exact action, requires review for new commands and retains historical reduction', async () => {
  const f = await prepared(), v = await readProductRuntimeStateVersion(f.sessionId), state = (await readProductRuntimeState(f.sessionId)).interaction!
  const envelope = {sequence: v.sequence + 1, actorKey: 'guard', triggerSequence: f.triggerSequence, messageId: 'test', action}
  expect(applyChatNarrativeActionV1(state, envelope).remainingDirectorBudget).toBe(99)
  expect(applyReviewedChatNarrativeActionV1(state, {...envelope, review: chatActionReviewFixture(action)}).remainingDirectorBudget).toBe(98)
  const incomplete = chatActionReviewFixture(action); incomplete.checks.pop()
  expect(() => parseChatNarrativeActionReviewV1(incomplete, action)).toThrow('不完整')
  expect(() => parseChatNarrativeActionReviewV1(chatActionReviewFixture(action), {...action, text: 'another action'})).toThrow('另一份候选')
  await expect(commitChatNarrativeAction({sessionId: f.sessionId, commandId: 'unreviewed', baseSequence: v.sequence, baseStateHash: v.stateHash,
    actorKey: 'guard', triggerSequence: f.triggerSequence, messageId: 'unreviewed', action, review: undefined as never})).rejects.toThrow()
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(v)
})
it('restores an unreviewed action without exposing it and only calls the missing review step', async () => {
  const f = await prepared(); let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onNarrativeActionSaved: id => {runId = id; throw new Error('host-crash')}})).rejects.toThrow('host-crash')
  db.close(); await db.open()
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow('尚未审查')
  let calls = 0
  await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async () => {calls++; return JSON.stringify(chatActionReviewOutputFixture())}})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  expect(calls).toBe(1)
  expect((await readInstanceAgentRunV1(f.scope, runId)).events.filter(e => e.type === 'model.requested')).toHaveLength(3)
})
it.each([false, true])('does not resend an interrupted review; retained response=%s', async retained => {
  const f = await prepared(); let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onNarrativeActionSaved: id => {runId = id; throw new Error('host-crash')}})).rejects.toThrow('host-crash')
  const stepId = CHAT_ACTION_REVIEW_STEP_V1
  const append = (type: 'step.scheduled' | 'step.started' | 'context.assembled' | 'model.requested' | 'model.responded', payload: unknown) => appendAgentRunEventV1({scope: f.scope, runId, productRuntimeSessionId: f.sessionId, type, payload} as Parameters<typeof appendAgentRunEventV1>[0])
  await append('step.scheduled', {stepId}); await append('step.started', {stepId, attempt: 1})
  const saved = await readInstanceAgentRunV1(f.scope, runId), sourceKeys = ['chatSituationRuntime', 'chatActionCandidate']
  const assembled = await assembleContext({projectId: f.scope.projectId, scope: f.scope, worldGroupId: saved.contract.scope.worldGroupId,
    productRuntimeSessionId: f.sessionId, chatActionCandidateRunId: runId, sourceKeys, inputBudgetMaxTokens: 24_000})
  expect(assembled.included).toEqual(expect.arrayContaining(sourceKeys))
  const manifest = await createContextManifestFromAssemblyV1({runId, stepId, attempt: 1, projectId: f.scope.projectId,
    worldGroupId: saved.contract.scope.worldGroupId, declaredSourceKeys: sourceKeys, assembled, readerVersion: 'chat-action-review-v14'})
  await append('context.assembled', {stepId, attempt: 1, manifestHash: manifest.manifestHash})
  // Injected review recovery fixture: preserve its complete request and actual
  // registered source, not just a model-request marker with an arbitrary hash.
  const messages = [{role: 'system', content: '工程模拟的独立行动审查，不是真实模型质量证据。'}, {role: 'user', content: assembled.text}]
  await recordAgentRunArtifactV1({scope: f.scope, runId, productRuntimeSessionId: f.sessionId, artifactKind: 'rendered-request', content: JSON.stringify(messages), stepId, attempt: 1})
  await append('model.requested', {stepId, attempt: 1, bindingHash: await hashCanonicalValue({runtimeBindingHash: saved.contract.runtimeBindingHash, manifestHash: manifest.manifestHash, messages})})
  if (retained) {
    const content = JSON.stringify(chatActionReviewOutputFixture())
    await append('model.responded', {stepId, attempt: 1, outputHash: await hashCanonicalValue(content)})
    await recordAgentRunArtifactV1({scope: f.scope, runId, productRuntimeSessionId: f.sessionId, artifactKind: 'raw-response', content, stepId, attempt: 1})
    await recordChatActionOutputBudgetV1({scope: f.scope, snapshot: await readInstanceAgentRunV1(f.scope, runId), stepId, output: content, result: {}, injected: true})
  }
  let calls = 0
  const resume = () => resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async () => {calls++; return '{}'}})
  if (retained) {await resume(); await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})}
  else await expect(resume()).rejects.toThrow('结果未知')
  expect(calls).toBe(0)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toHaveLength(retained ? 1 : 0)
})
it.each(['cancel', 'player-input'])('does not adopt a review arriving after %s', async mode => {
  const f = await prepared(); let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runReviewAI: async () => {
    if (mode === 'cancel') await cancelInteractionRuntimeRunV1({scope: f.scope, runId})
    else {const v = await readProductRuntimeStateVersion(f.sessionId); await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'interrupt', baseSequence: v.sequence, baseStateHash: v.stateHash, messageId: 'interrupt', text: '先停一下。'})}
    return JSON.stringify(chatActionReviewOutputFixture())
  }})).rejects.toThrow()
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.messages.filter(m => m.role === 'character')).toEqual([])
  expect(state.chatNarrative!.situation.facts.some(f => f.factKey === 'lamp')).toBe(false)
})


it('retains malformed coordinator output privately without echoing secrets in the player error', async () => {
  const f = await prepared(), raw = '幕后秘密：铜印在柜台下，不是合法 JSON'
  let error: unknown
  try {await generateInteractionRuntimeCandidateV1({...input(f), runReviewAI: async () => raw})} catch (reason) {error = reason}
  expect(String(error)).toContain('审查响应格式无效')
  expect(String(error)).not.toContain('柜台下')
  expect((await db.agentRunArtifacts.toArray()).some(a => a.artifactKind === 'raw-response' && a.content === raw)).toBe(true)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toEqual([])
})
