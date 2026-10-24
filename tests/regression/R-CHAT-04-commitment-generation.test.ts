import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {supportsChatCommitmentPromptV2} from '../../src/lib/character-interaction/commitment-prompt'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {chatPromiseActionFixture, chatCommitmentReviewOutputFixture} from '../helpers/chat-commitment-fixture'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function prepared() {
  const f = await seedChatNarrativeRuntimeFixture(), v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'commitment-generation.start', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  return f
}
const action = () => chatPromiseActionFixture('转告调查结果前，我会先问你是否同意。')

it('selects the clarification only for the three newly frozen producer versions', () => {
  for (const id of ['character.chat-narrative-action', 'character.chat-narrative-options', 'character.chat-action-revision'] as const) {
    expect(supportsChatCommitmentPromptV2(skills.getAgentSkillV1(id).promptVersion)).toBe(true)
  }
  for (const version of [undefined, 'chat-narrative-action-v30', 'chat-narrative-options-v20', 'chat-action-revision-v12', 'chat-narrative-action-review-v24']) {
    expect(supportsChatCommitmentPromptV2(version)).toBe(false)
  }
})

it.each([false, true])('records the exact producer instructions while keeping the independent review and versioned call budget (legacy=%s)', async legacy => {
  if (legacy) {
    const original = skills.getAgentSkillV1
    vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-narrative-action' ? {...original(id), promptVersion: 'chat-narrative-action-v30'} : original(id))
  }
  const f = await prepared(), a = action(); let calls = 0, rendered = ''
  const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '未来条件约定的工程输入验证',
    runAI: withChatActionChoiceFixture(async messages => {
      calls++; rendered = JSON.stringify(messages)
      expect(messages[0].content.includes('现在明确承担的未来义务或持续限制已成立')).toBe(!legacy)
      expect(messages[0].content.includes('commitmentEffects 默认 []')).toBe(legacy)
      expect(messages[0].content.includes('依据完整 text，确无变化才 []')).toBe(!legacy)
      expect(messages[1].content).not.toContain('柜台下')
      return JSON.stringify(a)
    }),
    runReviewAI: async messages => {
      calls++; expect(messages[0].content).toContain('明确的新约定、实际履行或明确撤回若漏记，在 consequences 判失败')
      expect(messages[0].content).not.toContain('约定成立的时点与履行条件发生的时点不同')
      return JSON.stringify(chatCommitmentReviewOutputFixture(a))
    },
  })
  expect(generated.snapshot.contract.budget.maxModelCalls).toBe(legacy ? 2 : 3); expect(calls).toBe(2)
  expect(generated.snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(legacy ? 2 : 3)
  expect(generated.snapshot.contract.executionBindings!.find(b => b.stepId === 'interaction:runtime-candidate')!.promptVersion).toBe(legacy ? 'chat-narrative-action-v30' : 'chat-narrative-action-v72')
  expect((await db.agentRunArtifacts.toArray()).some(a => a.artifactKind === 'rendered-request' && a.content === rendered)).toBe(true)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.situation.goals[0].commitments![0].terms).toBe(a.text)
  expect(state.messages).toHaveLength(1)
})

it('still rejects an omitted promise without committing the expression or silently issuing another call', async () => {
  const f = await prepared(), a = {...action(), commitmentEffects: []}, before = await readProductRuntimeState(f.sessionId); let calls = 0, runId = 0
  const rejected = chatCommitmentReviewOutputFixture(a); rejected.checks.find(c => c.check === 'consequences')!.passed = false
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '缺失后果仍被拦截',
    runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(a)}), runReviewAI: async () => {calls++; return JSON.stringify(rejected)}, onRunCreated: id => {runId = id},
  })).rejects.toThrow('语义审查未通过')
  expect(calls).toBe(2); expect((await db.agentRuns.get(runId))!.status).toBe('failed')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})
