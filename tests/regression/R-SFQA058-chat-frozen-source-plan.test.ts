import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { parseChatAuthoringSettings } from '../../src/lib/character-interaction/authoring-contract'
import {
  confirmChatSourceReviewV1, createChatDraftV3, loadChatSourceProjectionV1, saveChatDraftV1, selectChatWorldV1,
} from '../../src/lib/character-interaction/draft-service'
import type { ChatNarrativeProductionSourceV1 } from '../../src/lib/character-interaction/narrative-production'
import { chatProjectionResourcesV1 } from '../../src/lib/character-interaction/source-projection'
import { db } from '../../src/lib/db/schema'
import type { ProductSourcePlan } from '../../src/lib/types'
import { aggregateProductSourceManifestFromExactRuns } from '../../src/lib/product/source-contracts'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import {
  createBuiltInProductionCapabilityBindingV1, createConfiguredProductProductionExecutorV1, type ProductionTextRunnerV1,
} from '../../src/lib/product-production/production-executor'
import { runProductProductionSchedulerCycleV1, runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'
import { confirmChatSituationDecisionV1, readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import { parseProductProductionSourcePlanV1 } from '../../src/lib/product-production/source-contracts'
import {
  loadProductProductionConsultationSourceV2, loadProductProductionWorldSourceCatalogV2,
} from '../../src/lib/product-production/world-source'
import {
  chatOpeningDevelopmentReviewFixture, chatOpeningPerspectiveReviewFixture, chatSituationCandidatesFixture,
} from '../helpers/chat-narrative-production-fixture'
import { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { confirmNarrativeDomainAnnotationsV1 } from '../../src/lib/world-engine/narrative-domain-authoring'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { seedNarrativeRelationReleaseV4 } from '../helpers/narrative-release-fixture'

let fetch: ReturnType<typeof vi.fn>
beforeEach(async () => {
  await db.delete()
  await db.open()
  fetch = vi.fn(async () => { throw Error('SFQA-058 forbids network') })
  vi.stubGlobal('fetch', fetch)
})
afterEach(async () => { vi.unstubAllGlobals(); await db.delete() })

const privateAlias = 'sfqa058-author-only-alias'

async function enhancedSource(illustrated: boolean) {
  const seeded = await seedNarrativeRelationReleaseV4({ explicitEntityEvidence: true })
  if (!illustrated) return seeded.release
  const { scope } = seeded
  const owner = { kind: 'world' as const, worldCode: seeded.world.code, sourceWorkCode: null }
  for (const recordId of [seeded.actorId, seeded.secondActorId]) {
    const capture = await captureNarrativeDomainV1({ scope, owner })
    const row = capture.rows.get('characters')!.find(item => item.id === recordId)!
    await confirmNarrativeDomainAnnotationsV1({
      scope, owner, table: 'characters', recordId,
      expectedSourceHash: await hashNarrativeDomainSourceV1(capture, 'characters', row),
      annotations: { narrativeAliasesV1: [privateAlias] },
    })
  }
  const revision = await createWorldRevision({
    scope, formatVersion: 4, selectedTables: ['characters', 'characterRelations'], label: '058 授权审查来源',
  })
  return publishWorldRevision(revision.id!)
}

async function prepare(version: 1 | 2, illustrated = false) {
  const release = version === 2
    ? await enhancedSource(illustrated)
    : (await seedCurrentProductWorld('058 ordinary WorldRelease')).release
  const { scope } = await createChatDraftV3('058 formal ChatDraft')
  const linked = await selectChatWorldV1(scope, 0, release.id!)
  const index = await loadProductProductionConsultationSourceV2({
    scope, worldReleaseId: linked.worldReleaseId!, productType: 'character-interaction',
  })
  expect(index.worldReference.version).toBe(version)
  const sourceKey = index.selectionOptions.characters[0]!.resourceKey
  const base = parseChatAuthoringSettings(JSON.parse(linked.settingsJson))
  if (base.version !== 3) throw Error('fixture requires current ChatDraft V3')
  const draft = await saveChatDraftV1(scope, linked.revision, {
    ...base, mode: 'single', playerRole: '来到桥边的旅人', openingSituation: '在桥边商议已经获准的修桥准备。',
    characters: [{ sourceKey, voiceRules: '自然简短', privateKnowledge: '', initialTrust: 0 }],
    ...(illustrated ? { visuals: { version: 1 as const,
      characters: [{ characterKey: sourceKey, description: '蓝色围裙，完整清晰的面容。' }],
      openingBackground: '没有人物的明亮木屋与整洁木桌。',
    } } : {}),
  })
  const projection = await loadChatSourceProjectionV1(scope, draft.revision)
  const protectedFragment = illustrated ? projection.characters[0]?.fragments.find(
    fragment => fragment.pointer === '/atom/aliases' && fragment.valueJson.includes(privateAlias),
  ) : undefined
  if (illustrated && !protectedFragment) throw Error('fixture must expose an exact alias for explicit author-only classification')
  const confirmed = await confirmChatSourceReviewV1(scope, draft.revision, {
    projectionHash: projection.projectionHash,
    classifications: chatProjectionResourcesV1(projection).flatMap(resource => resource.fragments.map(fragment => ({
      projectionHash: projection.projectionHash, fragmentKey: fragment.fragmentKey,
      purpose: 'identity' as const,
      visibility: fragment.fragmentKey === protectedFragment?.fragmentKey ? 'author-only' as const : 'public' as const,
      audienceKeys: [],
    }))),
  })
  const settings = parseChatAuthoringSettings(JSON.parse(confirmed.settingsJson))
  if (settings.version !== 3) throw Error('fixture lost current V3 settings')
  const worldReleaseId = confirmed.worldReleaseId!
  const suggestions = await suggestProductStartingPoints({ scope, worldReleaseId, productType: 'character-interaction' })
  const brief = await draftProductProductionBriefV3({
    scope, worldReleaseId, suggestionKey: suggestions.suggestions[0]!.suggestionKey, productType: 'character-interaction',
    characterChat: settings, playerRole: settings.playerRole, openingSituation: settings.openingSituation,
    scale: 'scene', visualLevel: illustrated ? 'key-scenes' : 'none', audioLevel: 'none',
  })
  const key = `sfqa058.chat.${version}`
  const intent = await executeProductProductionCommand({ scope, command: {
    type: 'create-intent', commandId: `${key}.intent`, productionKey: key, productType: 'character-interaction',
    worldReleaseId, userText: '制作角色聊天',
  } })
  const productionId = intent.productionId
  const saved = await executeProductProductionCommand({ scope, productionId, command: {
    type: 'save-brief-revision', commandId: `${key}.brief`, expectedStateRevision: 0, parentRevision: null, brief,
  } })
  expect(saved.ok).toBe(true)
  const requirementKey = brief.capabilityRequirements.find(r => r.mediaClass === 'text')!.requirementKey
  const bindingHash = await hashProductProductionValueV2({ fixture: '058-no-network' })
  const capabilityBindings = [{ requirementKey, adapterId: 'configured-text.v1', bindingHash }]
  const authorize = async () => {
    const authorized = await executeProductProductionCommand({ scope, productionId, command: {
      type: 'authorize-start', commandId: `${key}.start`, expectedStateRevision: 1, briefRevision: 1,
      briefHash: String(saved.result.briefHash), authorizationNonce: `${key}.nonce`,
    } })
    expect(authorized.ok, JSON.stringify(authorized.result)).toBe(true)
    const row = await db.productProductionBriefs.where('productionId').equals(productionId).first()
    return parseProductProductionSourcePlanV1(row!)
  }
  return { scope, worldReleaseId, brief, productionId, authorize, capabilityBindings,
    requirementKey, bindingHash, protectedFragment, publicName: projection.characters[0]!.label, privateCharacters: settings.privateCharacters }
}

it.each([1, 2] as const)('uses the authorized frozen Plan in public V3 content.design on WorldReference V%i', async version => {
  const f = await prepare(version)
  const { scope, productionId, brief } = f
  const runText = vi.fn(async () => { throw Error('content.design must not dispatch a model') })
  const makeExecutor = async (sourcePlan: ProductSourcePlan) => createConfiguredProductProductionExecutorV1({
    production: (await db.productProductions.get(productionId))!, brief, sourcePlan, runText,
  })
  if (version === 2) {
    const unauthorized = vi.fn(async () => { throw Error('unapproved build must not execute') })
    await expect(runProductProductionSchedulerCycleV1({
      scope, productionId, capabilityBindings: f.capabilityBindings, executor: unauthorized,
    })).rejects.toThrow(/Build|授权/)
    expect(unauthorized).not.toHaveBeenCalled()
    expect(await db.productBuilds.where('productionId').equals(productionId).count()).toBe(0)
  }
  const sourcePlan = await f.authorize()
  expect(sourcePlan.worldReference.version).toBe(version)
  const catalogInput = { scope, worldReleaseId: f.worldReleaseId, selection: brief.source.selection,
    chatPrivateCharacters: f.privateCharacters }
  expect((await loadProductProductionWorldSourceCatalogV2({ ...catalogInput, sourcePlan })).characters.length).toBeGreaterThan(0)
  if (version === 2) {
    await expect(loadProductProductionWorldSourceCatalogV2(catalogInput))
      .rejects.toThrow(/产品定向目录不能作为正式生产原文授权/)
    expect((await loadProductProductionWorldSourceCatalogV2({ ...catalogInput, chatSourceReview: true }))
      .chatSourceProjection?.characters.length).toBeGreaterThan(0)
    await expect(loadProductProductionWorldSourceCatalogV2({ ...catalogInput, sourcePlan: { ...sourcePlan, productType: 'avg' } }))
      .rejects.toThrow(/来源计划的版本或产品不一致/)
    await expect(loadProductProductionWorldSourceCatalogV2({
      ...catalogInput, sourcePlan, selection: { ...brief.source.selection, version: 1 },
    })).rejects.toThrow(/来源计划的版本或产品不一致/)
  }
  let error = ''
  const execute = await makeExecutor(sourcePlan)
  const result = await runProductProductionSchedulerCycleV1({
    scope, productionId, capabilityBindings: f.capabilityBindings,
    executor: async request => {
      try { return await execute(request) } catch (cause) { error = String(cause); throw cause }
    },
  })
  const design = await db.productBuildArtifacts.where('buildId').equals(result.buildId)
    .filter(artifact => artifact.artifactKey === 'design.game').first()
  expect({ status: result.tasks.find(task => task.taskKey === 'content.design')?.status, error, hasDesign: !!design })
    .toEqual({ status: 'completed', error: '', hasDesign: true })
  expect(runText).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
}, 60_000)

it('keeps the same exact V2 source boundary through the real illustrated media requirements task', async () => {
  const f = await prepare(2, true)
  const { scope, productionId, brief, requirementKey, bindingHash } = f
  const sourcePlan = await f.authorize()
  const bindings = [...f.capabilityBindings,
    await createBuiltInProductionCapabilityBindingV1({ requirementKey: 'media.visual', adapterId: 'storyforge.procedural-svg.v1' })]
  const calls: string[] = []
  expect(JSON.parse(f.protectedFragment!.valueJson)).toContain(privateAlias)
  const protectedText = privateAlias
  const buildRows = async () => {
    const details = await readProductProductionDetailsV1(scope, productionId)
    return db.productBuildArtifacts.where('buildId').equals(details.build!.id!).toArray()
  }
  const runText: ProductionTextRunnerV1 = async request => {
    const isSituation = request.system.includes('初始情境编辑')
    const isReview = request.system.includes('开场的语义审查者')
    if (!isSituation && !isReview) throw Error('unexpected synthetic text stage')
    calls.push(isSituation ? 'situation' : 'review')
    expect(request.contextText).not.toContain(protectedText)
    const rows = await buildRows()
    const source = JSON.parse(rows.find(row => row.artifactKey === 'design.game')!.payloadJson) as ChatNarrativeProductionSourceV1
    const candidates = isSituation ? chatSituationCandidatesFixture(source)
      : JSON.parse(rows.find(row => row.artifactKey === 'content.chat-candidates')!.payloadJson)
    const body = isSituation ? candidates
      : chatOpeningPerspectiveReviewFixture(source, candidates, chatOpeningDevelopmentReviewFixture(candidates, 'option-1'))
    return { output: JSON.stringify(body), usage: { inputTokens: 100, outputTokens: 100 }, bindingReceipt: {
      schema: 'storyforge.provider-binding-receipt', version: 1, requirementKey, adapterId: 'configured-text.v1',
      adapterVersion: 1, provider: 'fixture', model: 'fixture', endpointOrigin: 'https://fixture.invalid',
      executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
      capabilityHash: bindingHash, boundAt: 1, receiptHash: 'b'.repeat(64),
    } }
  }
  const run = async () => runProductProductionUntilBlockedV1({
    scope, productionId, capabilityBindings: bindings,
    executor: createConfiguredProductProductionExecutorV1({
      production: (await db.productProductions.get(productionId))!, brief, sourcePlan, runText,
    }),
  })
  await run()
  const details = await readProductProductionDetailsV1(scope, productionId)
  expect(JSON.parse(details.build!.failureJson)).toMatchObject({ taskKey: 'content.chat-author-gate' })
  const rows = await buildRows()
  const design = rows.find(row => row.artifactKey === 'design.game')!
  expect(JSON.parse(design.payloadJson).participants[0].name).toBe(f.publicName)
  expect(design.payloadJson).not.toContain(protectedText)
  const candidates = rows.find(row => row.artifactKey === 'content.chat-candidates')!
  await confirmChatSituationDecisionV1({
    scope, details, candidatesHash: candidates.contentHash, sourceHash: design.contentHash, selectedOptionKey: 'option-2',
  })
  await run()
  const after = await readProductProductionDetailsV1(scope, productionId)
  expect(JSON.parse(after.build!.failureJson)).toMatchObject({ taskKey: 'media.chat-author-gate' })
  const media = (await buildRows()).find(row => row.artifactKey === 'media.requirements')!
  expect(JSON.parse(media.payloadJson).visual).toHaveLength(2)
  expect(media.payloadJson).not.toContain(protectedText)
  expect(calls).toEqual(['situation', 'review'])
  const pointers = []
  for (const artifact of [design, media]) {
    const snapshot = await readAgentRunV1(scope, artifact.producerRunId!)
    expect(snapshot.projection.terminalReceiptHash).toBe(artifact.producerReceiptHash)
    for (const event of snapshot.events) {
      if (event.type !== 'context.assembled') continue
      pointers.push({ runId: snapshot.run.id, stepId: event.payload.stepId,
        attempt: event.payload.attempt, manifestHash: event.payload.manifestHash })
    }
  }
  expect(pointers.map(pointer => pointer.stepId)).toEqual(['content.design', 'media.requirements'])
  const manifest = await aggregateProductSourceManifestFromExactRuns({ scope, sourcePlan, runContextManifests: pointers })
  expect(manifest.sourcePlanHash).toBe(sourcePlan.planHash)
  expect(fetch).not.toHaveBeenCalled()
}, 90_000)
