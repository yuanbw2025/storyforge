import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {createHash} from 'node:crypto'
import {db} from '../../src/lib/db/schema'
import * as runs from '../../src/lib/agent/run/event-store'
import {getAgentSkillV1} from '../../src/lib/agent/skill-registry'
import {chatOpeningReferencePromptV3} from '../../src/lib/character-interaction/opening-option-repair'
import {chatOpeningReviewPromptV1} from '../../src/lib/character-interaction/situation-production-review'
import {chatOpeningContinuationProductionPromptV1, chatOpeningContinuationReviewPromptV1} from '../../src/lib/character-interaction/opening-continuation'
import {readChatOpeningProductionVersionV1} from '../../src/lib/character-interaction/opening-production-binding'
import {createProductProductionPlanV3} from '../../src/lib/product-production/plan'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'
import type {ProductProductionTaskExecutionInputV1} from '../../src/lib/product-production/scheduler'
import {seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

it('preserves independently captured legacy prompt bytes and their repair/output contracts', () => {
  // Captured from the immutable V247 server before this change, with zero POSTs.
  const hash = (text: string) => createHash('sha256').update(text).digest('hex')
  expect(hash(chatOpeningReferencePromptV3())).toBe('e977ae976574fa6921c0fbc03ad6a54d51e23ffd463ccb200e01365eea684cc5')
  expect(hash(chatOpeningReviewPromptV1(2))).toBe('c76b57644260fa826a0c463bd37e700a710f51b3047a943eb3e6498907f46d66')
  expect(chatOpeningContinuationProductionPromptV1().endsWith(chatOpeningReferencePromptV3())).toBe(true)
  expect(chatOpeningContinuationReviewPromptV1().endsWith(chatOpeningReviewPromptV1(2))).toBe(true)
})

it.each([
  ['content.product-module', 'character.chat-situation-production', 'chat-situation-production-v14', 'chat-situation-production-v11'],
  ['content.chat-opening-review', 'character.chat-opening-review', 'chat-opening-review-v14', 'chat-opening-review-v2'],
])('selects continuation policy from the saved %s binding without upgrading historical runs', async (taskKey, skillId, current, previous) => {
  const f = await seedChatNarrativeProductionFixture()
  const plan = await createProductProductionPlanV3({brief: f.brief, briefHash: await hashProductProductionValueV2(f.brief), buildNumber: 1})
  const task = plan.tasks.find(t => t.taskKey === taskKey)!
  const input = {scope: f.scope, buildId: 7, buildNumber: 2, controlEpoch: 3, planHash: 'a'.repeat(64), taskRunId: 1, task} as ProductProductionTaskExecutionInputV1
  const snapshot = {contract: {permissions: {contextSourceKeys: ['product-production.chat-opening-review-inputs']}, scope: {productProduction: {
    productBuildId: input.buildId, buildNumber: input.buildNumber, controlEpoch: input.controlEpoch, planHash: input.planHash, taskKey,
  }}, executionBindings: [{stepId: taskKey, skillId, promptVersion: current}]}} as runs.AgentRunSnapshotV1
  vi.spyOn(runs, 'readAgentRunV1').mockResolvedValue(snapshot)
  expect(getAgentSkillV1(skillId)?.promptVersion).toBe(current)
  const selected = await readChatOpeningProductionVersionV1(input)
  expect(selected).toMatchObject({groundedAgency: true, meaningfulContinuation: true, authoredBackground: true, developmentProof: true})
  const legacyInput = {...input, task: {...task, acceptanceGateIds: task.acceptanceGateIds.filter(g => g !== 'chat.opening-development.v3')}}
  await expect(readChatOpeningProductionVersionV1(legacyInput)).rejects.toThrow('不能自动换约')
  if (taskKey === 'content.chat-opening-review') {
    expect(selected.compactReview).toBe(true)
    expect(selected.proofCitationReview).toBe(true)
    expect(selected.relationalReview).toBe(true)
    snapshot.contract.executionBindings![0].promptVersion = 'chat-opening-review-v13'
    await expect(readChatOpeningProductionVersionV1(input)).resolves.toEqual(Object.fromEntries(Object.entries(selected).filter(([key]) => key !== 'relationalReview')))
    snapshot.contract.executionBindings![0].promptVersion = 'chat-opening-review-v12'
    await expect(readChatOpeningProductionVersionV1(input)).resolves.toEqual(Object.fromEntries(Object.entries(selected).filter(([key]) => !['proofCitationReview', 'relationalReview'].includes(key))))
    expect(selected.keyedReview).toBe(true)
    snapshot.contract.executionBindings![0].promptVersion = 'chat-opening-review-v11'
    await expect(readChatOpeningProductionVersionV1(input)).resolves.toEqual(Object.fromEntries(Object.entries(selected).filter(([key]) => !['keyedReview', 'proofCitationReview', 'relationalReview'].includes(key))))
    snapshot.contract.executionBindings![0].promptVersion = 'chat-opening-review-v10'
    await expect(readChatOpeningProductionVersionV1(input)).resolves.toEqual(Object.fromEntries(Object.entries(selected).filter(([key]) => !['referenceReview', 'keyedReview', 'proofCitationReview', 'relationalReview'].includes(key))))
    snapshot.contract.executionBindings![0].promptVersion = 'chat-opening-review-v9'
    await expect(readChatOpeningProductionVersionV1(input)).resolves.toEqual(Object.fromEntries(Object.entries(selected).filter(([key]) => !['compactReview', 'referenceReview', 'keyedReview', 'proofCitationReview', 'relationalReview'].includes(key))))
    snapshot.contract.executionBindings![0].promptVersion = current
    expect(selected.scopedReview).toBe(true)
    expect(selected.independentReview).toBe(true)
    expect(selected.flatReview).toBe(true)
    expect(selected.reviewOutputLimit).toBe(10_000)
    snapshot.contract.executionBindings![0].promptVersion = 'chat-opening-review-v7'
    await expect(readChatOpeningProductionVersionV1(legacyInput)).resolves.toEqual({groundedAgency: true, meaningfulContinuation: true, scopedReview: true, independentReview: true, flatReview: true, authoredBackground: true})
    snapshot.contract.executionBindings![0].promptVersion = 'chat-opening-review-v6'
    await expect(readChatOpeningProductionVersionV1(legacyInput)).resolves.toEqual({groundedAgency: true, meaningfulContinuation: true, scopedReview: true, independentReview: true, flatReview: true})
    snapshot.contract.executionBindings![0].promptVersion = 'chat-opening-review-v5'
    await expect(readChatOpeningProductionVersionV1(legacyInput)).resolves.toEqual({groundedAgency: true, meaningfulContinuation: true, scopedReview: true, independentReview: true})
    snapshot.contract.executionBindings![0].promptVersion = 'chat-opening-review-v4'
    await expect(readChatOpeningProductionVersionV1(legacyInput)).resolves.toEqual({groundedAgency: true, meaningfulContinuation: true, scopedReview: true})
    snapshot.contract.executionBindings![0].promptVersion = 'chat-opening-review-v3'
    await expect(readChatOpeningProductionVersionV1(legacyInput)).resolves.toEqual({groundedAgency: true, meaningfulContinuation: true})
  }
  if (taskKey === 'content.product-module') {
    expect(selected).toMatchObject({completeSourceFacts: true, sourceReferences: true, targetedRepair: true, patchRepair: true, optionRepair: true})
    snapshot.contract.executionBindings![0].promptVersion = 'chat-situation-production-v12'
    await expect(readChatOpeningProductionVersionV1(legacyInput)).resolves.toEqual(Object.fromEntries(Object.entries(selected).filter(([key]) => !['authoredBackground', 'developmentProof'].includes(key))))
    snapshot.contract.executionBindings![0].promptVersion = current
    for (const gate of ['chat.opening-source-completeness.v1', 'chat.opening-option-repair.v1', 'chat.opening-source-references.v1', 'chat.opening-targeted-repair.v2']) {
      await expect(readChatOpeningProductionVersionV1({...input, task: {...task, acceptanceGateIds: task.acceptanceGateIds.filter(id => id !== gate)}})).rejects.toThrow('不能自动换约')
    }
    await expect(readChatOpeningProductionVersionV1({...input, task: {...task, budgetReservation: {...task.budgetReservation, modelCalls: 1}}})).rejects.toThrow('不能自动换约')
  }
  snapshot.contract.executionBindings![0].promptVersion = previous
  await expect(readChatOpeningProductionVersionV1(input)).rejects.toThrow('不能自动换约')
  const historical = await readChatOpeningProductionVersionV1(legacyInput)
  expect(historical).toEqual(Object.fromEntries(Object.entries(selected).filter(([key]) => !['meaningfulContinuation', 'scopedReview', 'independentReview', 'flatReview', 'authoredBackground', 'reviewOutputLimit', 'developmentProof', 'compactReview', 'referenceReview', 'keyedReview', 'proofCitationReview', 'relationalReview'].includes(key))))
  expect(getAgentSkillV1(skillId)?.promptVersion).toBe(current)
})
