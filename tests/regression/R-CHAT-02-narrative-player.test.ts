import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {useCharacterInteractionPlayerStore as store} from '../../src/stores/character-interaction-player'
import * as harness from '../../src/lib/character-interaction/harness'
import * as runtimeApi from '../../src/lib/character-interaction/runtime-api'
import {readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {seedChatNarrativeRuntimeFixture, chatActionReviewOutputFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const realGenerate = harness.generateInteractionRuntimeCandidateV1
const generate = (input: Parameters<typeof realGenerate>[0]) => realGenerate({...input, runReviewAI: input.runReviewAI ?? (async () => JSON.stringify(chatActionReviewOutputFixture()))})
const aiConfig = {} as never
const action = (text = '可以一起看看后门；也可以先休息。'): ChatNarrativeActionV1 => ({
  kind: 'attempt', text, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'],
  waitingForPlayer: true, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
})
const advance = (kind: 'scene-start' | 'continue' | 'return' = 'scene-start') => store.getState().advanceNarrative({kind, participantKey: 'guard', aiConfig})
beforeEach(async () => {
  db.close(); await db.delete(); await db.open()
  store.setState({busy: false, generatingRunId: null, scope: null, selectedSessionId: null})
})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function loaded(maxActionsPerTrigger = 1) {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger})
  await store.getState().load(f.scope, null, f.sessionId)
  return f
}

for (const delayed of ['library', 'details-error', 'selection'] as const) it(`keeps the latest workspace or selection when an older ${delayed} finishes late`, async () => {
  const first = await seedChatNarrativeRuntimeFixture(), second = await seedChatNarrativeRuntimeFixture()
  let resume!: () => void, entered = false
  const gate = new Promise<void>(resolve => {resume = resolve})
  if (delayed !== 'details-error') {
    const original = db.productReleases.where.bind(db.productReleases)
    vi.spyOn(db.productReleases, 'where').mockImplementation(((index: string) => {
      const where = original(index), equals = where.equals.bind(where)
      where.equals = value => {
        const collection = equals(value), read = collection.toArray.bind(collection)
        if (value === first.scope.projectId) collection.toArray = (async () => {
          entered = true; await gate; return read()
        }) as typeof collection.toArray
        return collection
      }
      return where
    }) as typeof db.productReleases.where)
  } else {
    const original = runtimeApi.readProductRuntimeState
    vi.spyOn(runtimeApi, 'readProductRuntimeState').mockImplementation(async (...args) => {
      if (args[0] === first.sessionId) {entered = true; await gate; throw new Error('obsolete workspace read failed')}
      return original(...args)
    })
  }
  const older = store.getState().load(first.scope, null, first.sessionId)
  await vi.waitFor(() => expect(entered).toBe(true))
  if (delayed === 'selection') await store.getState().select(null)
  else await store.getState().load(second.scope, null, second.sessionId)
  const current = store.getState()
  resume(); await older
  expect(store.getState().scope).toEqual(current.scope)
  expect(store.getState().selectedSessionId).toBe(current.selectedSessionId)
  expect(store.getState().sessions).toEqual(current.sessions)
  expect(store.getState().releases).toEqual(current.releases)
  expect(store.getState().runtimeState).toEqual(current.runtimeState)
  expect(store.getState().error).toBe('')
  expect(store.getState().loading).toBe(false)
})

it('opens without fake player input, stops for a decision, routes refusal through actions and never generates on reload', async () => {
  const f = await loaded(3)
  const spy = vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input, runAI: withChatActionChoiceFixture(async () => JSON.stringify(action()))}))
  await advance()
  expect(spy).toHaveBeenCalledTimes(1)
  expect(store.getState().runtimeState.interaction!.messages.map(m => m.role)).toEqual(['character'])
  expect(store.getState().runtimeState.interaction!.chatNarrative!.triggers.at(-1)!.status).toBe('waiting-player')
  await advance()
  expect(spy).toHaveBeenCalledTimes(1)
  db.close(); await db.open(); await store.getState().load(f.scope, null, f.sessionId)
  expect(spy).toHaveBeenCalledTimes(1)
  const sequence = await store.getState().sendPlayerMessage('不去后门，先在这里休息。')
  await store.getState().generateReplies({aiConfig, replyToSequence: sequence, preferredParticipantKey: 'guard'})
  expect(spy).toHaveBeenCalledTimes(2)
  expect(spy.mock.calls.every(([i]) => i.skillId === 'character.chat-narrative-action')).toBe(true)
  expect(store.getState().runtimeState.interaction!.chatNarrative!.triggers.map(t => t.status)).toEqual(['cancelled', 'waiting-player'])
  await store.getState().generateReplies({aiConfig, replyToSequence: sequence, preferredParticipantKey: 'guard'})
  expect(spy).toHaveBeenCalledTimes(2)
  await advance('continue'); await advance('return')
  expect(store.getState().runtimeState.interaction!.messages.filter(m => m.role === 'player')).toHaveLength(1)
  expect(store.getState().runtimeState.interaction!.chatNarrative!.situation.facts).toHaveLength(4)
})

it('uses the frozen action limit and a pause stops the bounded loop early', async () => {
  await loaded(3)
  let calls = 0
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input, runAI: withChatActionChoiceFixture(async () => {
    calls++
    return JSON.stringify({...action(`叶岑自己整理物品 ${calls}。`), kind: calls === 2 ? 'pause' : 'complete', waitingForPlayer: false})
  })}))
  await advance()
  expect(calls).toBe(2)
  expect(store.getState().runtimeState.interaction!.chatNarrative!.triggers.at(-1)!.status).toBe('complete')
  expect(store.getState().runtimeState.interaction!.remainingDirectorBudget).toBe(94)
  await advance('continue')
  expect(calls).toBe(5)
  expect(store.getState().runtimeState.interaction!.chatNarrative!.triggers.at(-1)!.actionSequences).toHaveLength(3)
})

it('blocks a second paid attempt at the same head, preserves failures and requires a fresh explicit trigger', async () => {
  const f = await loaded()
  let calls = 0
  const spy = vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input, runAI: withChatActionChoiceFixture(async () => {calls++; throw new Error('401 no retry')}) }))
  await expect(advance()).rejects.toThrow('401')
  expect(store.getState()).toMatchObject({busy: false, generatingRunId: null})
  await expect(advance()).rejects.toThrow('已发起')
  await expect(generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: 'duplicate', runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(action())})})).rejects.toThrow('已有行动运行')
  expect(calls).toBe(1)
  spy.mockImplementation(input => generate({...input, runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(action())})}))
  await advance('continue')
  expect(calls).toBe(2)
})

it('retains the completed part of a bounded turn across failure and never repeats its consequence', async () => {
  const f = await loaded(3)
  let calls = 0
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input, runAI: withChatActionChoiceFixture(async () => {
    calls++
    if (calls === 2) throw new Error('connection lost')
    return JSON.stringify({...action(calls === 1 ? '叶岑移好了油灯。门边亮了起来。' : '叶岑停下，等你先休息。'), kind: calls === 1 ? 'complete' : 'pause', waitingForPlayer: false,
      newFacts: calls === 1 ? [{factKey: 'lit-door', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'}] : []})
  })}))
  await expect(advance()).rejects.toThrow('connection lost')
  db.close(); await db.open(); await store.getState().load(f.scope, null, f.sessionId)
  expect(store.getState().runtimeState.interaction!.messages).toHaveLength(1)
  await advance('continue')
  expect(calls).toBe(3)
  expect(store.getState().runtimeState.interaction!.messages).toHaveLength(2)
  expect(store.getState().runtimeState.interaction!.chatNarrative!.situation.facts.filter(fact => fact.factKey === 'lit-door')).toHaveLength(1)
})

it('recovers a durable candidate before allowing more generation and cancels an orphan explicitly', async () => {
  const f = await loaded()
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'prepared', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const candidate = await generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: 'durable', runAI: withChatActionChoiceFixture(async () => JSON.stringify(action()))})
  db.close(); await db.open(); await store.getState().load(f.scope, null, f.sessionId)
  expect(store.getState().recoverableRunIds).toEqual([candidate.snapshot.run.id])
  await expect(advance('continue')).rejects.toThrow('先恢复候选或取消')
  await store.getState().resumeRun(candidate.snapshot.run.id)
  expect(store.getState().pendingNarrativeRunIds).toEqual([])
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input,
    onRunCreated: () => {throw new Error('process disappeared')}, runAI: withChatActionChoiceFixture(async () => {throw new Error('must not call')})}))
  await expect(advance('continue')).rejects.toThrow('process disappeared')
  expect(store.getState().pendingNarrativeRunIds).toHaveLength(1)
  expect(store.getState().recoverableRunIds).toEqual([])
  await expect(advance('continue')).rejects.toThrow('尚未结束')
  await store.getState().cancelPendingRun(store.getState().pendingNarrativeRunIds[0])
  expect(store.getState().pendingNarrativeRunIds).toEqual([])
})

it('player input cancels an in-flight action even if the provider ignores abort', async () => {
  await loaded(3)
  let release!: () => void
  const pending = new Promise<void>(resolve => {release = resolve})
  let started!: () => void
  const entered = new Promise<void>(resolve => {started = resolve})
  let calls = 0
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input, runAI: withChatActionChoiceFixture(async () => {calls++; started(); await pending; return JSON.stringify(action())})}))
  const generation = advance().catch(reason => reason)
  await entered
  const sending = store.getState().sendPlayerMessage('停一下，我想换条路。')
  await sending
  expect(store.getState().runtimeState.interaction!.messages.map(m => m.role)).toEqual(['player'])
  expect(store.getState().busy).toBe(true)
  release()
  await generation
  expect(calls).toBe(1)
  expect(store.getState().runtimeState.interaction!.messages.map(m => m.role)).toEqual(['player'])
  expect(store.getState().runtimeState.interaction!.chatNarrative!.triggers.at(-1)!.status).toBe('cancelled')
  expect(store.getState().runtimeState.interaction!.remainingDirectorBudget).toBe(100)
})

it('requires an explicit actor for multiple roles and rejects legacy text-only replacement of committed actions', async () => {
  await loaded()
  const spy = vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1')
  await expect(store.getState().advanceNarrative({kind: 'scene-start', aiConfig})).rejects.toThrow('请选择本轮行动')
  expect(spy).not.toHaveBeenCalled()
  expect(store.getState().runtimeState.interaction!.chatNarrative!.triggers).toEqual([])
  await expect(store.getState().retryReply({aiConfig, replySequence: 123})).rejects.toThrow('检查点建立分支')
})

it('constructs and reviews an explicit seed before the role acts, preserving refusal and refresh semantics', async () => {
  const f = await loaded(3), seen: string[] = []
  const draft = {kind: 'chat-situation', title: '敲门声', location: '驿站', timeLabel: '傍晚',
    newFacts: [{factKey: 'knocking', kind: 'observation', text: '门外传来敲门声。', audienceKeys: ['guard', 'artisan', 'player'], evidenceFactKeys: ['road'], seedExcerpt: '门外传来敲门声'}],
    newGoals: [{goalKey: 'understand-knock', actorKey: 'guard', desire: '了解来意', concern: '贸然开门', boundary: '不替玩家行动', evidenceFactKeys: ['knocking']}], newThreads: [], possibilities: []}
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input,
    runAI: withChatActionChoiceFixture(async messages => {
      seen.push(input.skillId)
      if (input.skillId === 'character.chat-situation-construction') return JSON.stringify(draft)
      const prompt = JSON.stringify(messages)
      expect(prompt).toContain('knocking'); expect(prompt).not.toContain('柜台下'); expect(prompt).not.toContain('幕后要求')
      return JSON.stringify({...action('我想问问门外的人。你要一起听吗？'), goalKey: 'understand-knock', evidenceFactKeys: ['knocking']})
    }), runReviewAI: async () => {if (input.skillId === 'character.chat-narrative-action') return JSON.stringify(chatActionReviewOutputFixture()); seen.push('review'); return JSON.stringify({checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'meaningful-direction'].map(check => ({check, passed: true, reason: 'test'}))})},
  }))
  await store.getState().createSituation({seed: '门外传来敲门声。幕后要求保持身份未知。', participantKey: 'guard', aiConfig})
  expect(seen).toEqual(['character.chat-situation-construction', 'review', 'character.chat-narrative-action'])
  expect(store.getState().runtimeState.interaction!.messages.map(m => m.role)).toEqual(['character'])
  expect(store.getState().runtimeState.interaction!.remainingDirectorBudget).toBe(95)
  db.close(); await db.open(); await store.getState().load(f.scope, null, f.sessionId)
  expect(seen).toHaveLength(3)
  expect(store.getState().pendingNarrativeRunIds).toEqual([])
  const seq = await store.getState().sendPlayerMessage('先别开门。')
  await store.getState().generateReplies({aiConfig, replyToSequence: seq, preferredParticipantKey: 'guard'})
  expect(seen.at(-1)).toBe('character.chat-narrative-action')
  expect(store.getState().runtimeState.interaction!.chatNarrative!.situation.facts.filter(f => f.factKey === 'knocking')).toHaveLength(1)
})
