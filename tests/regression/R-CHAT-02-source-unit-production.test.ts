import {chatOpeningRelationalReviewSchemaV1, chatOpeningRelationalReviewPromptV1} from '../../src/lib/character-interaction/opening-review-relations'
import {estimateTokens} from '../../src/lib/ai/context-budget'
import {estimateChatRequestOptionsTokens} from '../../src/lib/ai/client'
import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import type {ProductReleaseManifestV1} from '../../src/lib/types/product-release'
import {seedChatSourceUnitConfirmationFixture, sourceUnitAuthorizationReportFixture} from '../helpers/chat-source-unit-confirmation'
import {saveChatDraftV1, readChatDraftV1} from '../../src/lib/character-interaction/draft-service'
import {reviewChatSourceUnitConfirmationV1, adoptChatSourceUnitConfirmationV1} from '../../src/lib/character-interaction/source-unit-confirmation-harness'
import {chatRoleProfileCompilerInput} from '../helpers/chat-role-profile'
import {chatSituationCandidatesFixture, chatSituationReferenceDraftFixture, chatOpeningProofReviewFixture} from '../helpers/chat-narrative-production-fixture'
import type {ChatNarrativeProductionSourceV1} from '../../src/lib/character-interaction/narrative-production'
import {executeProductProductionCommand} from '../../src/lib/product-production/commands'
import {createConfiguredProductProductionExecutorV1, type ProductionTextRunnerV1} from '../../src/lib/product-production/production-executor'
import {runProductProductionUntilBlockedV1} from '../../src/lib/product-production/scheduler'
import {readProductProductionDetailsV1, confirmChatSituationDecisionV1, listProductProductionReviewArtifactsV1, publishProductProductionV1} from '../../src/lib/product-production/service'
import {parseProductRuntimePackageV1} from '../../src/lib/product-production/runtime-package'
import {createCharacterInteractionInstance} from '../../src/lib/product/runtime-instances'
import {readProductRuntimeState} from '../../src/lib/character-interaction/runtime-api'
import {interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import {removeChatSourceUnitBundleV1} from '../../src/lib/character-interaction/source-unit-store'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {SOURCE_UNITS_FIXTURE_TEXT} from '../helpers/chat-source-units'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())

it.each([false, true])('carries author-confirmed units through real production commands, source manifests, selection, Release, new session and portable restore (references=%s)', async referenceWire => {
  // Scripted semantic decisions test the production boundary, not real-model quality.
  const f = await seedChatSourceUnitConfirmationFixture(), worlds = await db.worldReleases.toArray()
  const draft = await saveChatDraftV1(f.scope, f.draft.revision, {...f.settings, narrative: {...f.settings.narrative,
    permissions: {...f.settings.narrative.permissions, allowInquiryResults: true}}})
  const request = {...f.request, source: {...f.request.source, draftRevision: draft.revision}}
  const reviewed = await reviewChatSourceUnitConfirmationV1({scope: f.scope, request,
    runAI: async () => JSON.stringify(sourceUnitAuthorizationReportFixture(f.candidate, f.permissions))})
  expect((await readChatDraftV1(f.scope)).sourceUnitsJson).toBeUndefined()
  await adoptChatSourceUnitConfirmationV1({scope: f.scope, runId: reviewed.runId, expectedCandidateHash: reviewed.candidateHash!, candidate: f.candidate, permissions: f.permissions})
  const {brief} = await chatRoleProfileCompilerInput(f.scope)
  expect(brief.characterChatSourceUnits!.bundles).toHaveLength(1)
  expect(brief.characterChat!.version).toBe(3)
  const created = await executeProductProductionCommand({scope: f.scope, command: {type: 'create-intent', commandId: 'units.intent',
    productionKey: 'chat.source-units', productType: 'character-interaction', worldReleaseId: draft.worldReleaseId!, userText: '原子事实生产链工程测试'}})
  expect(created.ok).toBe(true)
  const productionId = created.productionId
  const saved = await executeProductProductionCommand({scope: f.scope, productionId, command: {type: 'save-brief-revision', commandId: 'units.brief', expectedStateRevision: 0, parentRevision: null, brief}})
  expect(saved.ok).toBe(true)
  const started = await executeProductProductionCommand({scope: f.scope, productionId, command: {type: 'authorize-start', commandId: 'units.start', expectedStateRevision: 1, briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: 'author.start'}})
  expect(started.ok).toBe(true)
  const requirementKey = brief.capabilityRequirements.find(r => r.mediaClass === 'text')!.requirementKey, bindingHash = 'a'.repeat(64), calls: string[] = []
  const runText: ProductionTextRunnerV1 = async input => {
    const isGeneration = input.system.includes('初始情境编辑'), isReview = input.system.includes('开场的语义审查者')
    calls.push(isGeneration ? 'generation' : isReview ? 'review' : 'media')
    const artifact = await db.productBuildArtifacts.filter(row => row.artifactKey === 'design.game').last()
    const source = JSON.parse(artifact!.payloadJson) as ChatNarrativeProductionSourceV1
    expect(source.source.version).toBe(6)
    expect(source.settings.narrative.permissions.allowInquiryResults).toBe(true)
    expect(source.source.sourceUnits!.bundles[0].source.fragments[0].valueJson).toBe(JSON.stringify(SOURCE_UNITS_FIXTURE_TEXT))
    if (isGeneration) {
      expect(input.system).toContain('带 source.unit 的逐项确认事实全部由系统保留')
      expect(input.system).toContain('人物存在不等于在场')
    }
    if (isReview) expect(input.system).toContain('系统校验身份、引用和知情范围')
    const candidates = isReview ? JSON.parse((await db.productBuildArtifacts.filter(row => row.artifactKey === 'content.chat-candidates').last())!.payloadJson) : chatSituationCandidatesFixture(source)
    const references = referenceWire && isGeneration ? await chatSituationReferenceDraftFixture(source, candidates) : null
    // The author-confirmed units, including undiscoverable secrets, must survive
    // even when the model selects no world fact at all.
    if (references) for (const option of references.options) option.situation.worldFactKeys = []
    const output = isGeneration ? references ?? candidates : isReview ? chatOpeningProofReviewFixture(source, candidates) : {schema: 'storyforge.product-media-requirements-artifact', version: 2, visual: [], audio: []}
    return {output: JSON.stringify(output), usage: {inputTokens: 100, outputTokens: 100}, bindingReceipt: {
      schema: 'storyforge.provider-binding-receipt', version: 1, requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
      provider: 'fixture', model: 'fixture-model', endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct',
      credentialSource: 'existing-ai-config', credentialPresent: true, capabilityHash: bindingHash, boundAt: 1, receiptHash: 'b'.repeat(64),
    }}
  }
  const execute = async () => runProductProductionUntilBlockedV1({scope: f.scope, productionId, capabilityBindings: [{requirementKey, adapterId: 'configured-text.v1', bindingHash}],
    executor: async input => {
      if (input.task.taskKey === 'content.chat-opening-review') {
        const source = JSON.parse((await db.productBuildArtifacts.filter(row => row.buildId === input.buildId && row.artifactKey === 'design.game').last())!.payloadJson)
        const candidates = JSON.parse((await db.productBuildArtifacts.filter(row => row.buildId === input.buildId && row.artifactKey === 'content.chat-candidates').last())!.payloadJson)
        const schema = chatOpeningRelationalReviewSchemaV1(source, candidates)
        const total = estimateTokens(input.contextText + chatOpeningRelationalReviewPromptV1()) + estimateChatRequestOptionsTokens({jsonSchema: schema})
        expect(total, 'Complete author source, catalog and complete output schema must fit the original review input reservation').toBeLessThanOrEqual(input.task.budgetReservation.inputTokens)
      }
      return createConfiguredProductProductionExecutorV1({production: (await db.productProductions.get(productionId))!, brief, runText})(input)
    }})
  await execute()
  let details = await readProductProductionDetailsV1(f.scope, productionId)
  expect(JSON.parse(details.build!.failureJson), details.build!.failureJson).toMatchObject({taskKey: 'content.chat-author-gate'})
  expect(calls).toEqual(['generation', 'review'])
  await expect(publishProductProductionV1({scope: f.scope, productionId})).rejects.toThrow()
  const artifacts = await listProductProductionReviewArtifactsV1({scope: f.scope, buildId: details.build!.id!})
  await confirmChatSituationDecisionV1({scope: f.scope, details, sourceHash: artifacts.find(a => a.artifactKey === 'design.game')!.contentHash,
    candidatesHash: artifacts.find(a => a.artifactKey === 'content.chat-candidates')!.contentHash, selectedOptionKey: 'option-2'})
  await execute(); details = await readProductProductionDetailsV1(f.scope, productionId)
  expect(details.build!.status, details.build!.failureJson).toBe('release-ready')
  const completed = await listProductProductionReviewArtifactsV1({scope: f.scope, buildId: details.build!.id!}), runtime = parseProductRuntimePackageV1(completed.find(a => a.artifactKey === 'runtime.package')!.payload)
  const reviewPayload = completed.find(a => a.artifactKey === 'quality.chat-openings')!.payload
  expect(reviewPayload).toMatchObject({version: 3, options: expect.arrayContaining([expect.objectContaining({agency: expect.objectContaining({mode: 'act'})})])})
  expect(JSON.stringify(runtime)).not.toContain('工程注入的背景依据')
  const source = runtime.interaction!.chatSource!, story = runtime.interaction!.chatNarrative!
  expect(source.version).toBe(6); expect(story.permissions.allowInquiryResults).toBe(true)
  expect(source.sourceUnits).toEqual(brief.characterChatSourceUnits)
  for (const unit of source.knowledge.filter(k => k.source.unit)) {
    const facts = story.initialSituation.facts.filter(f => f.sourceKnowledgeKey === unit.key)
    expect(facts).toHaveLength(1); expect(facts[0].text).toBe(unit.content); expect(facts[0].audienceKeys).toEqual([])
    expect(facts[0].discovery?.condition).toBe(unit.discovery?.condition)
  }
  const published = await publishProductProductionV1({scope: f.scope, productionId})
  const releaseBefore = await db.productReleases.get(published.receipt.productReleaseId)
  const manifest = JSON.parse(releaseBefore!.manifestJson) as ProductReleaseManifestV1
  if (!('sourceManifest' in manifest.sourceContracts)) throw new Error('Expected world-derived chat source contracts')
  expect(manifest.sourceContracts.sourceManifest.runContextManifests.length).toBeGreaterThan(0)
  for (const unit of source.knowledge.filter(k => k.source.unit)) {
    expect(manifest.sourceContracts.sourceManifest.resources.some(resource => resource.resourceKey === unit.source.resourceKey
      && resource.contentHashes.includes(unit.source.sourceHash) && resource.contextManifestHashes.length > 0)).toBe(true)
  }
  expect(manifest.runtimePackage.interaction!.chatSource!.sourceUnits).toEqual(source.sourceUnits)
  const session = await createCharacterInteractionInstance({scope: f.scope, productReleaseId: published.receipt.productReleaseId, title: '事实整理正式发行工程存档'})
  const state = await readProductRuntimeState(session.id!)
  expect(state.interaction!.chatNarrative!.permissions.allowInquiryResults).toBe(true)
  expect(JSON.stringify(interactionVisibilityView(state.interaction!, 'player'))).not.toContain('拓印破损的通行单')
  expect(JSON.stringify(interactionVisibilityView(state.interaction!, state.interaction!.profiles[0].participantKey))).not.toContain('拓印破损的通行单')
  const current = await readChatDraftV1(f.scope)
  await removeChatSourceUnitBundleV1(f.scope, current.revision, request.source.fragmentKeys)
  expect(JSON.parse((await readChatDraftV1(f.scope)).sourceUnitsJson!).bundles).toEqual([])
  expect(await db.productReleases.get(published.receipt.productReleaseId)).toEqual(releaseBefore)
  expect(await readProductRuntimeState(session.id!)).toEqual(state)
  const importedId = await importProjectJSON(await exportProjectJSON(f.scope.projectId)), restored = (await db.productRuntimeSessions.where('projectId').equals(importedId).toArray()).find(s => s.title === session.title)!
  db.close(); await db.open()
  expect((await readProductRuntimeState(restored.id!)).interaction).toEqual(state.interaction)
  const importedReports = await db.productBuildArtifacts.where('projectId').equals(importedId).filter(a => a.artifactKey === 'quality.chat-openings').toArray()
  expect(importedReports.some(a => JSON.stringify(JSON.parse(a.payloadJson)) === JSON.stringify(reviewPayload))).toBe(true)
  expect(calls).toEqual(['generation', 'review', 'media'])
  for (const world of worlds) expect(await db.worldReleases.get(world.id!)).toEqual(world)
})
