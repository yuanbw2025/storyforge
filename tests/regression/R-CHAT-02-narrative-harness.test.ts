import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {adoptInteractionRuntimeCandidateV1, cancelInteractionRuntimeRunV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {readInstanceAgentRunV1} from '../../src/lib/agent/run/event-store'
import {seedChatNarrativeRuntimeFixture, chatActionReviewOutputFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const action: ChatNarrativeActionV1 = {kind: 'complete', text: '叶岑把灯移到了门边。门边亮了起来。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player', 'artisan'], waitingForPlayer: false,
  newFacts: [{factKey: 'lamp-moved', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'}], disclosures: [], threadUpdates: [], goalStatus: null}
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())
async function prepared() {
  const f = await seedChatNarrativeRuntimeFixture()
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'start', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  return f
}
function input(f: Awaited<ReturnType<typeof prepared>>) {
  return {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const, objective: '根据当前情境采取一次合理行动', runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())}
}

it('retains a filtered action candidate across refresh and recovers one atomic consequence after a crash', async () => {
  const f = await prepared(), before = await readProductRuntimeStateVersion(f.sessionId)
  let calls = 0
  const emitted: string[] = []
  const produce = withChatActionChoiceFixture(async messages => {
    calls++
    const prompt = JSON.stringify(messages)
    expect(prompt).toContain('maxActionsPerTrigger')
    expect(prompt).toContain('担心再次错怪人')
    expect(prompt).not.toContain('柜台下')
    expect(prompt).not.toContain('天黑后不宜')
    return JSON.stringify(action)
  })
  const generated = await generateInteractionRuntimeCandidateV1({...input(f), runAI: async (...args) => {
    const raw = await produce(...args); emitted.push(raw); return raw
  }})
  expect(generated.candidate.kind).toBe('chat-narrative-action-candidate')
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(before)
  db.close(); await db.open()
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id, onDurableBoundary: type => {if (type === 'runtime.candidate.adopted') throw new Error('simulated-crash')}})).rejects.toThrow('simulated-crash')
  const committed = await readProductRuntimeStateVersion(f.sessionId)
  expect(committed.sequence).toBe(before.sequence + 1)
  db.close(); await db.open()
  const recovered = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  expect(recovered.snapshot.projection.state).toBe('completed')
  expect(recovered.receiptHash).toMatch(/^[a-f0-9]{64}$/)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(committed)
  const state = await readProductRuntimeState(f.sessionId)
  expect(state.interaction!.messages).toHaveLength(1)
  expect(state.interaction!.messages[0].role).toBe('character')
  expect(state.interaction!.chatNarrative!.situation.facts.at(-1)!.factKey).toBe('lamp-moved')
  expect(calls).toBe(1)
  expect(emitted).toHaveLength(2)
  const rawResponses = (await db.agentRunArtifacts.toArray()).filter(a => a.artifactKind === 'raw-response').map(a => a.content)
  for (const raw of emitted) expect(rawResponses).toContain(raw)
})

it('a player interruption makes a generated action stale and does not commit any partial consequence', async () => {
  const f = await prepared()
  const generated = await generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async () => JSON.stringify(action))})
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'stop', baseSequence: v.sequence, baseStateHash: v.stateHash, messageId: 'stop', text: '先等等，我想换个办法。', audienceKeys: ['guard', 'artisan']})
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).rejects.toThrow()
  const run = await readInstanceAgentRunV1(f.scope, generated.snapshot.run.id)
  expect(run.events.some(e => e.type === 'candidate.staled')).toBe(true)
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.messages.map(m => m.role)).toEqual(['player'])
  expect(state.chatNarrative!.situation.facts).toHaveLength(4)
})

it('preserves invalid raw output for inspection and fails without retry or an adoptable candidate', async () => {
  const f = await prepared(), before = await readProductRuntimeStateVersion(f.sessionId)
  let runId = 0, calls = 0
  const bad = {...action, evidenceFactKeys: ['secret']}
  const emitted: string[] = [], produce = withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(bad)})
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runAI: async (...args) => {
    const raw = await produce(...args); emitted.push(raw); return raw
  }})).rejects.toThrow('不可知')
  expect(calls).toBe(1)
  const run = await readInstanceAgentRunV1(f.scope, runId)
  expect(run.projection.state).toBe('failed')
  expect(run.events.some(e => e.type === 'candidate.persisted')).toBe(false)
  expect(emitted).toHaveLength(2)
  const rawResponses = (await db.agentRunArtifacts.toArray()).filter(a => a.artifactKind === 'raw-response').map(a => a.content)
  for (const raw of emitted) expect(rawResponses).toContain(raw)
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(before)
})

it('honors cancellation even when a provider returns a result after abort', async () => {
  const f = await prepared(), controller = new AbortController()
  let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), signal: controller.signal, onRunCreated: id => {runId = id}, runAI: withChatActionChoiceFixture(async () => {controller.abort(); return JSON.stringify(action)})})).rejects.toThrow('取消')
  const run = await readInstanceAgentRunV1(f.scope, runId)
  expect(run.projection.state).toBe('cancelled')
  expect(run.events.some(e => e.type === 'candidate.persisted')).toBe(false)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toEqual([])
})

it('refuses model calls without a prepared trigger and prevents legacy reply bypass', async () => {
  const f = await seedChatNarrativeRuntimeFixture()
  let calls = 0
  const runAI = async () => {calls++; return JSON.stringify(action)}
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI})).rejects.toThrow('合法叙事触发')
  await expect(generateInteractionRuntimeCandidateV1({...input(f), skillId: 'character.interaction-reply', runAI})).rejects.toThrow('旧版回复')
  expect(calls).toBe(0)
})

it('cannot adopt a candidate after its run was explicitly cancelled', async () => {
  const f = await prepared()
  const generated = await generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async () => JSON.stringify(action))})
  await cancelInteractionRuntimeRunV1({scope: f.scope, runId: generated.snapshot.run.id})
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).rejects.toThrow('已取消')
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toEqual([])
})
