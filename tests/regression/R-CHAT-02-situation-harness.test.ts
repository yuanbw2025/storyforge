import {recordAgentRunArtifactV1} from '../../src/lib/memory/artifact-store'
import {CHAT_SITUATION_REVIEW_STEP_V1} from '../../src/lib/character-interaction/situation-harness'
import {hashCanonicalValue} from '../../src/lib/agent/run/hash'
import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1, cancelInteractionRuntimeRunV1, resumeChatSituationReviewV1} from '../../src/lib/character-interaction/harness'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger, commitInteractionPlayerMessage} from '../../src/lib/character-interaction/runtime-api'
import {seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'
import {appendAgentRunEventV1, readInstanceAgentRunV1} from '../../src/lib/agent/run/event-store'
import {CHAT_SITUATION_REVIEW_CHECKS_V1, type ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'
import {isChatSituationPreparedV1} from '../../src/lib/character-interaction/narrative-situations'

const draft: ChatSituationDraftV1 = {kind: 'chat-situation', title: '门外的声响', location: '驿站', timeLabel: '傍晚',
  newFacts: [{factKey: 'knocking', kind: 'observation', text: '门外传来敲门声。', audienceKeys: ['player', 'guard', 'artisan'], evidenceFactKeys: ['road'], seedExcerpt: '门外传来敲门声'}],
  newGoals: [{goalKey: 'understand-knock', actorKey: 'guard', desire: '了解来意', concern: '贸然开门', boundary: '不替玩家开门', evidenceFactKeys: ['knocking']}],
  newThreads: [], possibilities: [{actorKey: 'guard', text: '可以隔门询问，也可以等待。', evidenceFactKeys: ['knocking']}]}
const review = () => ({checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程夹具，不是模型质量验收'}))})
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())
async function prepared() {
  const f = await seedChatNarrativeRuntimeFixture(), v = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'seed', baseSequence: v.sequence, baseStateHash: v.stateHash,
    kind: 'player-seed', sourceEventSequence: v.sequence, seed: '门外传来敲门声。来者身份不要预先揭晓。'})
  return {...f, triggerSequence: trigger.sequence}
}
function input(f: Awaited<ReturnType<typeof prepared>>) {
  return {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'player', skillId: 'character.chat-situation-construction' as const,
    objective: '内化当前玩家情境请求', narrativeTriggerSequence: f.triggerSequence, runAI: async () => JSON.stringify(draft), runReviewAI: async () => JSON.stringify(review())}
}
it('persists two registered requests and exact responses, reviews the saved draft then atomically adopts after refresh', async () => {
  const f = await prepared(), before = await readProductRuntimeStateVersion(f.sessionId)
  const generated = await generateInteractionRuntimeCandidateV1({...input(f), runAI: async messages => {
    expect(JSON.stringify(messages)).toContain('柜台下')
    return JSON.stringify(draft)
  }, runReviewAI: async messages => {
    const text = JSON.stringify(messages)
    expect(text).toContain('本次持久化情境候选')
    expect(text).toContain('understand-knock')
    expect(text).toContain('柜台下')
    expect(text).toContain('meaningful-direction')
    return JSON.stringify(review())
  }})
  expect(generated.candidate.kind).toBe('chat-situation-candidate')
  expect(generated.snapshot.contract.executionBindings?.map(b => b.skillId)).toEqual(['character.chat-situation-construction', 'character.chat-situation-review'])
  expect(generated.snapshot.events.filter(e => e.type === 'model.requested')).toHaveLength(2)
  expect((await db.agentRunArtifacts.toArray()).filter(a => a.artifactKind === 'raw-response')).toHaveLength(2)
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(before)
  db.close(); await db.open()
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id, onDurableBoundary: type => {if (type === 'runtime.candidate.adopted') throw new Error('crash-after-commit')}})).rejects.toThrow('crash-after-commit')
  const adopted = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  expect(adopted.snapshot.projection.state).toBe('completed')
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(isChatSituationPreparedV1(state)).toBe(true)
  expect(state.messages).toEqual([])
  expect(state.chatNarrative!.situation.facts.at(-1)?.factKey).toBe('knocking')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  expect((await readProductRuntimeStateVersion(f.sessionId)).sequence).toBe(before.sequence + 1)
})
it.each(['continuity', 'permissions', 'player-agency', 'visibility', 'meaningful-direction'])('retains review rejection for %s without committing or silently regenerating', async check => {
  const f = await prepared(), before = await readProductRuntimeStateVersion(f.sessionId)
  let runId = 0, calls = 0
  const result = review(); result.checks.find(c => c.check === check)!.passed = false
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runReviewAI: async () => {calls++; return JSON.stringify(result)}})).rejects.toThrow('语义审查未通过')
  expect((await readInstanceAgentRunV1(f.scope, runId)).projection.state).toBe('failed')
  expect((await db.agentRunArtifacts.toArray()).some(a => a.content === JSON.stringify(result))).toBe(true)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  await expect(generateInteractionRuntimeCandidateV1(input(f))).rejects.toThrow('已有行动运行')
  expect(calls).toBe(1)
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(before)
})
it('fails structural violations before review and keeps malformed review output', async () => {
  const f = await prepared(); let reviewed = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: async () => JSON.stringify({...draft, location: '城门'}), runReviewAI: async () => {reviewed++; return '{}'}})).rejects.toThrow()
  expect(reviewed).toBe(0)
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'another', baseSequence: v.sequence, baseStateHash: v.stateHash,
    kind: 'player-seed', sourceEventSequence: v.sequence, seed: '门外传来敲门声。'})
  await expect(generateInteractionRuntimeCandidateV1({...input(f), narrativeTriggerSequence: undefined, runReviewAI: async () => 'broken-json'})).rejects.toThrow()
  expect((await db.agentRunArtifacts.toArray()).some(a => a.content === 'broken-json')).toBe(true)
})
it('rejects a late review after player interruption and preserves the player message', async () => {
  const f = await prepared()
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runReviewAI: async () => {
    const v = await readProductRuntimeStateVersion(f.sessionId)
    await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'interrupt', baseSequence: v.sequence, baseStateHash: v.stateHash,
      messageId: 'interrupt', text: '先别改变情境。', audienceKeys: ['guard']})
    return JSON.stringify(review())
  }})).rejects.toThrow()
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.messages.map(m => m.text)).toEqual(['先别改变情境。'])
  expect(state.chatNarrative!.situation.facts.some(f => f.factKey === 'knocking')).toBe(false)
})
it('honors durable cancellation while the review provider ignores abort', async () => {
  const f = await prepared(); let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runReviewAI: async () => {
    await cancelInteractionRuntimeRunV1({scope: f.scope, runId})
    return JSON.stringify(review())
  }})).rejects.toThrow()
  expect((await readInstanceAgentRunV1(f.scope, runId)).projection.state).toBe('cancelled')
  expect(isChatSituationPreparedV1((await readProductRuntimeState(f.sessionId)).interaction!)).toBe(false)
})

async function interruptedDraft() {
  const f = await prepared(); let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onSituationDraftSaved: id => {runId = id; throw new Error('host-crashed')}})).rejects.toThrow('host-crashed')
  return {...f, runId}
}
it('explicitly resumes a saved draft with one review call and never regenerates construction', async () => {
  const f = await interruptedDraft(); let calls = 0
  db.close(); await db.open()
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: f.runId})).rejects.toThrow('尚未审查')
  const result = await resumeChatSituationReviewV1({scope: f.scope, runId: f.runId, runReviewAI: async () => {calls++; return JSON.stringify(review())}})
  expect(result.candidate.review?.checks.every(c => c.passed)).toBe(true)
  await resumeChatSituationReviewV1({scope: f.scope, runId: f.runId, runReviewAI: async () => {calls++; return '{}'}})
  expect(calls).toBe(1)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: f.runId})
  expect((await readInstanceAgentRunV1(f.scope, f.runId)).events.filter(e => e.type === 'model.requested')).toHaveLength(2)
})
it.each([false, true])('recovers retained review=%s and never resends an unknown request', async retained => {
  const f = await interruptedDraft(), stepId = CHAT_SITUATION_REVIEW_STEP_V1
  const append = async (type: 'step.scheduled' | 'step.started' | 'model.requested' | 'model.responded', payload: unknown) =>
    appendAgentRunEventV1({scope: f.scope, runId: f.runId, productRuntimeSessionId: f.sessionId, type, payload} as Parameters<typeof appendAgentRunEventV1>[0])
  await append('step.scheduled', {stepId})
  await append('step.started', {stepId, attempt: 1})
  await append('model.requested', {stepId, attempt: 1, bindingHash: await hashCanonicalValue({test: 'crash-boundary'})})
  if (retained) {
    const content = JSON.stringify(review())
    await append('model.responded', {stepId, attempt: 1, outputHash: await hashCanonicalValue(content)})
    await recordAgentRunArtifactV1({scope: f.scope, runId: f.runId, productRuntimeSessionId: f.sessionId,
      artifactKind: 'raw-response', content, stepId, attempt: 1})
  }
  db.close(); await db.open()
  let calls = 0
  const resume = () => resumeChatSituationReviewV1({scope: f.scope, runId: f.runId, runReviewAI: async () => {calls++; return '{}'}})
  if (retained) {
    await resume()
    await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: f.runId})
  } else await expect(resume()).rejects.toThrow('结果未知')
  expect(calls).toBe(0)
  expect(isChatSituationPreparedV1((await readProductRuntimeState(f.sessionId)).interaction!)).toBe(retained)
})
