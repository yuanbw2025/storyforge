import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import * as skills from '../../src/lib/agent/skill-registry'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {chatActionChoiceVersionForContractV1, chatReviewedActionAllowanceV1, parseChatActionChoiceVersionV1} from '../../src/lib/character-interaction/action-choice-budget'
import {applyReviewedChatNarrativeActionV1} from '../../src/lib/character-interaction/narrative-actions'
import {commitChatNarrativeAction, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {validateImportedChatNarrativeEvidenceEventV1} from '../../src/lib/character-interaction/narrative-evidence-import'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const action: ChatNarrativeActionV1 = {kind: 'speak', text: '你还记得最后一次见到铜印的地方吗？', goalKey: 'find-seal', evidenceFactKeys: ['lost'],
  audienceKeys: ['player', 'guard', 'artisan'], waitingForPlayer: true, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
const review = {...chatActionReviewOutputFixture(), reviewedActionJson: canonicalStringify(action)}
const recipe = {executionBindings: [
  {stepId: 'interaction:action-choice', skillId: 'character.chat-narrative-action', promptVersion: 'chat-narrative-action-v45'},
  {stepId: 'interaction:runtime-candidate', skillId: 'character.chat-narrative-action', promptVersion: 'chat-narrative-action-v45'},
  {stepId: 'interaction:action-review', skillId: 'character.chat-narrative-action-review', promptVersion: 'chat-narrative-action-review-v32'},
], budget: {maxModelCalls: 3, maxAttemptsPerStep: 1}}
async function start() {
  const fixture = await seedChatNarrativeRuntimeFixture({directorBudget: 10}), before = await readProductRuntimeStateVersion(fixture.sessionId)
  await requestChatNarrativeTrigger({sessionId: fixture.sessionId, commandId: crypto.randomUUID(), baseSequence: before.sequence, baseStateHash: before.stateHash,
    kind: 'scene-start', sourceEventSequence: fixture.sceneSequence})
  const state = await readProductRuntimeState(fixture.sessionId), version = await readProductRuntimeStateVersion(fixture.sessionId)
  return {...fixture, state, version, input: {sequence: state.lastSequence + 1, triggerSequence: state.interaction!.chatNarrative!.triggers.slice(-1)[0]!.requestedSequence,
    actorKey: 'guard', messageId: 'choice-budget-fixture', action, review}}
}

it('charges the explicit new event three units and keeps an unversioned historical event at two', async () => {
  const {state, input} = await start(), before = structuredClone(state.interaction!)
  const old = applyReviewedChatNarrativeActionV1(state.interaction!, input)
  const selected = applyReviewedChatNarrativeActionV1(state.interaction!, {...input, actionChoiceVersion: 1})
  expect(old.remainingDirectorBudget).toBe(before.remainingDirectorBudget - 2)
  expect(selected.remainingDirectorBudget).toBe(before.remainingDirectorBudget - 3)
  expect({...selected, remainingDirectorBudget: old.remainingDirectorBudget}).toEqual(old)
  expect(state.interaction).toEqual(before)
})

it('rejects insufficient choice allowance or failed review without committing partial consequences', async () => {
  const {state, input} = await start(), onlyTwo = {...state.interaction!, remainingDirectorBudget: 2}, before = structuredClone(onlyTwo)
  expect(() => applyReviewedChatNarrativeActionV1(onlyTwo, {...input, actionChoiceVersion: 1})).toThrow('预算不足')
  expect(onlyTwo).toEqual(before)
  expect(applyReviewedChatNarrativeActionV1(onlyTwo, input).remainingDirectorBudget).toBe(0)
  const failed = structuredClone(review); failed.checks[0].passed = false
  const fullBefore = structuredClone(state.interaction!)
  expect(() => applyReviewedChatNarrativeActionV1(state.interaction!, {...input, review: failed, actionChoiceVersion: 1})).toThrow('语义审查未通过')
  expect(state.interaction).toEqual(fullBefore)
})

it('does not let a caller invent new accounting metadata without its original Harness run', async () => {
  const f = await start(), eventsBefore = await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).count()
  await expect(commitChatNarrativeAction({sessionId: f.sessionId, commandId: 'forged-choice-cost', baseSequence: f.version.sequence, baseStateHash: f.version.stateHash,
    ...f.input, actionChoiceVersion: 1})).rejects.toThrow('必须绑定原运行')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(f.state)
  expect(await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).count()).toBe(eventsBefore)
})

it('rejects a forged extra stage on a saved legacy run while leaving its original candidate adoptable', async () => {
  const originalSkill = skills.getAgentSkillV1
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => {
    const skill = originalSkill(id)
    return id === 'character.chat-narrative-action' ? {...skill, promptVersion: 'chat-narrative-action-v44'} : skill
  })
  const f = await start(), generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId,
    participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '旧合同额度兼容测试',
    runAI: async () => JSON.stringify(action), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await expect(commitChatNarrativeAction({sessionId: f.sessionId, commandId: 'forged-choice-on-legacy-run', baseSequence: f.version.sequence, baseStateHash: f.version.stateHash,
    ...f.input, actionChoiceVersion: 1, harnessRun: {id: generated.snapshot.run.id, lastSequence: generated.snapshot.projection.lastSequence}})).rejects.toThrow('与原运行合同不一致')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(f.state)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const after = await readProductRuntimeState(f.sessionId)
  expect(after.interaction!.remainingDirectorBudget).toBe(f.state.interaction!.remainingDirectorBudget - 2)
  const event = await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).last()
  expect(JSON.parse(event!.payloadJson)).not.toHaveProperty('actionChoiceVersion')
})

it.each([null, 0, 2, '1', true, {version: 1}])('rejects unknown event accounting version %# including imports', value => {
  expect(() => parseChatActionChoiceVersionV1(value)).toThrow('版本无效')
  expect(() => chatReviewedActionAllowanceV1(value)).toThrow('版本无效')
  expect(() => validateImportedChatNarrativeEvidenceEventV1(JSON.stringify({actionChoiceVersion: value}), 'character-interaction', 'interaction.narrative.action-reviewed.committed')).toThrow('版本无效')
})

it('keeps legacy imports unchanged and confines new accounting to reviewed character-chat actions', () => {
  expect(chatReviewedActionAllowanceV1(undefined)).toBe(2)
  expect(chatReviewedActionAllowanceV1(1)).toBe(3)
  expect(() => validateImportedChatNarrativeEvidenceEventV1('{}', 'ai-town', 'interaction.character.reply.committed')).not.toThrow()
  expect(() => validateImportedChatNarrativeEvidenceEventV1('{"actionChoiceVersion":1}', 'character-interaction', 'interaction.narrative.action-reviewed.committed')).not.toThrow()
  for (const [kind, event] of [['ai-town', 'interaction.narrative.action-reviewed.committed'], ['character-interaction', 'interaction.narrative.situation.committed'],
    ['character-interaction', 'interaction.narrative.action.committed'], ['character-interaction', 'interaction.player.message.committed']]) {
    expect(() => validateImportedChatNarrativeEvidenceEventV1('{"actionChoiceVersion":1}', kind, event)).toThrow()
  }
})

it('derives the allowance from a complete frozen recipe and rejects a silent extra call or mismatched producer', () => {
  expect(chatActionChoiceVersionForContractV1(recipe)).toBe(1)
  expect(chatActionChoiceVersionForContractV1({...recipe, executionBindings: recipe.executionBindings.slice(1)})).toBeUndefined()
  for (const patch of [{budget: {...recipe.budget, maxModelCalls: 2}}, {budget: {...recipe.budget, maxAttemptsPerStep: 2}},
    {executionBindings: recipe.executionBindings.filter(binding => binding.stepId !== 'interaction:action-review')},
    {executionBindings: recipe.executionBindings.map(binding => ({...binding, promptVersion: 'chat-narrative-action-v44'}))},
    {executionBindings: [recipe.executionBindings[0], ...recipe.executionBindings]}]) {
    expect(() => chatActionChoiceVersionForContractV1({...recipe, ...patch})).toThrow('冻结预算合同不一致')
  }
})
